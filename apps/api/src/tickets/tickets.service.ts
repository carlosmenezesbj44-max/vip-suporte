import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { IxcService } from '../ixc/ixc.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { SubmitSatisfactionDto } from './dto/submit-satisfaction.dto';
import { AuthenticatedUser, ConnectionDiagnostic, DEFAULT_DIAGNOSTIC_FLOW, DiagnosticFlowOperator, DiagnosticFlowRule, TicketCategory, TicketDepartment, TicketPriority, TicketStatus, UserRole } from '@canal-direto/shared';
import { randomBytes } from 'crypto';
import type { Express } from 'express';

type CommunicationFlowNode = { id: string; type: string; title?: string; text?: string; attempts?: number; errorMessage?: string; exhaustedMessage?: string; fallbackTargetId?: string; department?: string };
type CommunicationFlowEdge = { id: string; source: string; target: string; label?: string; sourcePort?: string };
type CommunicationFlow = { id: string; name: string; enabled?: boolean; nodes: CommunicationFlowNode[]; edges: CommunicationFlowEdge[] };
type CommunicationFlowState = { flowId: string; currentNodeId: string; attempts: number; status: 'WAITING' | 'COMPLETED' | 'STOPPED' };

function formatCustomerName(name: string) {
  const particles = new Set(['da', 'das', 'de', 'do', 'dos', 'e']);
  return name.trim().toLocaleLowerCase('pt-BR').split(/\s+/).map((part, index) =>
    index > 0 && particles.has(part) ? part : part.charAt(0).toLocaleUpperCase('pt-BR') + part.slice(1),
  ).join(' ');
}

@Injectable()
export class TicketsService {
  private readonly communicationFlowQueues = new Map<string, Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly ixcService: IxcService,
  ) {}

  /** Gera um protocolo amigável no formato ANO-SEQUENCIAL (ex: 2024-000123). */
  private async generateProtocol(): Promise<string> {
    const year = new Date().getFullYear();
    const countThisYear = await this.prisma.ticket.count({
      where: { createdAt: { gte: new Date(`${year}-01-01T00:00:00.000Z`) } },
    });
    const sequence = String(countThisYear + 1).padStart(6, '0');
    return `${year}-${sequence}`;
  }

  async create(customer: AuthenticatedUser, dto: CreateTicketDto) {
    const protocol = await this.generateProtocol();

    let ixcCustomerId: string | null = null;
    if (dto.ixcSearchTerm) {
      if (!dto.ixcCustomerId) throw new BadRequestException('Confirme seu cadastro no IXC antes de abrir o chamado');
      const verifiedCustomer = (await this.ixcService.searchCustomers(dto.ixcSearchTerm))
        .find((customer) => customer.id === dto.ixcCustomerId);
      if (!verifiedCustomer) {
        throw new BadRequestException('O cadastro selecionado não confere com a busca no IXC. Pesquise novamente.');
      }
      ixcCustomerId = verifiedCustomer.id;
    } else if (dto.ixcCustomerId) {
      throw new BadRequestException('Pesquise e confirme o cadastro no IXC antes de abrir o chamado');
    } else if (dto.cpfCnpj) {
      const ixcCustomer = await this.ixcService.findCustomerByDocument(dto.cpfCnpj);
      ixcCustomerId = ixcCustomer?.id ?? null;
    }

    return this.prisma.ticket.create({
      data: {
        protocol,
        title: dto.title,
        description: dto.description,
        category: dto.category,
        priority: TicketPriority.MEDIUM,
        status: TicketStatus.OPEN,
        customerId: customer.id,
        ixcCustomerId,
      },
      include: { customer: { select: { id: true, name: true } }, assignedTo: { select: { id: true, name: true } } },
    });
  }

  async createFromPortal(dto: CreateTicketDto) {
    if (!dto.ixcSearchTerm || !dto.ixcCustomerId) {
      throw new BadRequestException('Confirme seu cadastro no IXC antes de abrir o chamado');
    }
    const match = (await this.ixcService.searchCustomers(dto.ixcSearchTerm))
      .find((customer) => customer.id === dto.ixcCustomerId);
    if (!match) {
      throw new BadRequestException('O cadastro selecionado não confere com a busca no IXC. Pesquise novamente.');
    }

    // A abertura pelo portal não exige criar senha. Mantemos um cliente local vinculado ao IXC
    // para que o chamado use o mesmo histórico e apareça normalmente na fila dos atendentes.
    const email = `ixc-${match.id}@clientes.canal-direto.invalid`;
    const linkedCustomer = await this.prisma.user.findFirst({ where: { ixcCustomerId: match.id, isActive: true } });
    const customer = linkedCustomer ?? await this.prisma.user.upsert({
      where: { email },
      create: {
        name: match.razaoSocial || 'Cliente IXC',
        email,
        phone: null,
        passwordHash: randomBytes(32).toString('hex'),
        role: UserRole.CUSTOMER,
        ixcCustomerId: match.id,
      },
      update: {
        name: match.razaoSocial || 'Cliente IXC',
        ixcCustomerId: match.id,
        isActive: true,
      },
    });

    // Se o assinante já tem um chamado em andamento, retoma a conversa nele.
    // RESOLVED e CLOSED são estados finais e permitem uma nova solicitação.
    const existingTicket = await this.prisma.ticket.findFirst({
      where: {
        ixcCustomerId: match.id,
        status: { in: [TicketStatus.OPEN, TicketStatus.IN_PROGRESS, TicketStatus.WAITING_CUSTOMER] },
      },
      orderBy: { updatedAt: 'desc' },
      include: { customer: { select: { id: true, name: true } }, assignedTo: { select: { id: true, name: true } } },
    });
    if (existingTicket) {
      await this.startAssignedCommunicationFlow(existingTicket.id);
      return {
        ticket: existingTicket,
        sessionCustomer: { id: customer.id, email: customer.email, role: customer.role },
        reused: true,
      };
    }

    const protocol = await this.generateProtocol();
    const ticket = await this.prisma.ticket.create({
      data: {
        protocol,
        title: dto.title,
        description: dto.description,
        category: dto.category,
        priority: TicketPriority.MEDIUM,
        status: TicketStatus.OPEN,
        customerId: customer.id,
        ixcCustomerId: match.id,
      },
      include: { customer: { select: { id: true, name: true } }, assignedTo: { select: { id: true, name: true } } },
    });
    await this.startAssignedCommunicationFlow(ticket.id);
    return {
      ticket,
      sessionCustomer: { id: customer.id, email: customer.email, role: customer.role },
      reused: false,
    };
  }

  private async getAssignedPortalFlow(): Promise<CommunicationFlow | null> {
    const settings = await this.prisma.systemSettings.findUnique({
      where: { id: 'global' },
      select: { communicationFlows: true, channelFlowAssignments: true },
    });
    if (!settings) return null;
    const assignments = settings.channelFlowAssignments && typeof settings.channelFlowAssignments === 'object'
      ? settings.channelFlowAssignments as Record<string, string>
      : {};
    const flowId = assignments.PORTAL;
    if (!flowId || !Array.isArray(settings.communicationFlows)) return null;
    const flow = (settings.communicationFlows as unknown as CommunicationFlow[]).find((item) => item.id === flowId && item.enabled !== false);
    return flow && Array.isArray(flow.nodes) && Array.isArray(flow.edges) ? flow : null;
  }

  private async flowBot() {
    return this.prisma.user.upsert({
      where: { email: 'assistente-fluxo@canal-direto.invalid' },
      update: {},
      create: {
        name: 'Assistente virtual',
        email: 'assistente-fluxo@canal-direto.invalid',
        passwordHash: randomBytes(32).toString('hex'),
        role: UserRole.ADMIN,
        isActive: false,
      },
      select: { id: true, name: true },
    });
  }

  private async createFlowMessage(ticketId: string, message: string) {
    const bot = await this.flowBot();
    return this.prisma.ticketMessage.create({
      data: { ticketId, authorId: bot.id, message },
      include: { author: { select: { id: true, name: true } }, attachments: { select: { id: true, name: true, mimeType: true, size: true, createdAt: true } } },
    });
  }

  private async withCommunicationFlowLock<T>(ticketId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.communicationFlowQueues.get(ticketId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const queued = previous.then(() => current);
    this.communicationFlowQueues.set(ticketId, queued);
    await previous;
    try {
      return await work();
    } finally {
      release();
      if (this.communicationFlowQueues.get(ticketId) === queued) this.communicationFlowQueues.delete(ticketId);
    }
  }

  private flowPrompt(node: CommunicationFlowNode, edges: CommunicationFlowEdge[], customerName: string) {
    let prompt = (node.text || node.title || 'Como podemos ajudar?').replace(/\{\{nome_usuario\}\}/gi, formatCustomerName(customerName)).replace(/\{\{nome_empresa\}\}/gi, 'Canal Direto');
    const choices = edges.map((edge) => edge.label?.trim()).filter((label): label is string => !!label);
    if (choices.length) prompt += `\n\n${choices.map((choice, index) => `${index + 1}. ${choice}`).join('\n')}\nResponda com o número ou o assunto.`;
    return prompt;
  }

  private async startAssignedCommunicationFlow(ticketId: string) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId }, select: { status: true, assignedToId: true, communicationFlowState: true, customer: { select: { name: true } } } });
    if (!ticket || ticket.communicationFlowState || ticket.status !== TicketStatus.OPEN || ticket.assignedToId) return [];
    const flow = await this.getAssignedPortalFlow();
    const start = flow?.nodes.find((node) => node.type === 'START');
    if (!flow || !start) return [];
    await this.prisma.ticket.update({ where: { id: ticketId }, data: { communicationFlowState: { flowId: flow.id, currentNodeId: start.id, attempts: 0, status: 'WAITING' } } });
    return this.runCommunicationFlow(ticketId, flow, start.id, ticket.customer.name);
  }

  private async runCommunicationFlow(ticketId: string, flow: CommunicationFlow, firstNodeId: string, customerName: string, input?: string) {
    const createdMessages: Awaited<ReturnType<TicketsService['createFlowMessage']>>[] = [];
    let nodeId: string | undefined = firstNodeId;
    let currentInput = input;
    for (let steps = 0; nodeId && steps < 40; steps++) {
      const currentTicket = await this.prisma.ticket.findUnique({ where: { id: ticketId }, select: { status: true, assignedToId: true, department: true, communicationFlowState: true } });
      const currentState = currentTicket?.communicationFlowState as unknown as CommunicationFlowState | null;
      if (!currentTicket || currentTicket.status !== TicketStatus.OPEN || currentTicket.assignedToId || currentState?.status !== 'WAITING') {
        if (currentTicket && currentState?.status === 'WAITING' && (currentTicket.assignedToId || currentTicket.status !== TicketStatus.OPEN)) {
          await this.prisma.ticket.update({ where: { id: ticketId }, data: { communicationFlowState: { ...currentState, status: 'STOPPED' } } });
        }
        return createdMessages;
      }
      const node = flow.nodes.find((item) => item.id === nodeId);
      if (!node) break;
      const outgoing = flow.edges.filter((edge) => edge.source === node.id);
      if (node.type === 'START') {
        nodeId = outgoing[0]?.target;
        continue;
      }
      if (node.type === 'SEND_MESSAGE') {
        createdMessages.push(await this.createFlowMessage(ticketId, (node.text || node.title || '').replace(/\{\{nome_usuario\}\}/gi, formatCustomerName(customerName)).replace(/\{\{nome_empresa\}\}/gi, 'Canal Direto')));
        nodeId = outgoing[0]?.target;
        continue;
      }
      if (node.type === 'IDENTIFY_INTENT') {
        if (currentInput === undefined) {
          const prompt = this.flowPrompt(node, outgoing, customerName);
          if (prompt.trim()) createdMessages.push(await this.createFlowMessage(ticketId, prompt));
          await this.prisma.ticket.update({ where: { id: ticketId }, data: { communicationFlowState: { flowId: flow.id, currentNodeId: node.id, attempts: 0, status: 'WAITING' } } });
          return createdMessages;
        }
        const normalizedInput = currentInput.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
        let edge = /^\d+$/.test(normalizedInput) ? outgoing[Number(normalizedInput) - 1] : undefined;
        edge ||= outgoing.find((candidate) => {
          const label = (candidate.label || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
          return label && (normalizedInput.includes(label) || label.includes(normalizedInput));
        });
        if (!edge && /\b(sim|s|resolvi|resolveu|voltou|funcionou)\b/.test(normalizedInput)) {
          edge = outgoing.find((candidate) => /^(sim|yes)|resolv|solved|success|voltou/i.test(`${candidate.label || ''} ${candidate.sourcePort || ''}`));
        }
        if (!edge && /\b(nao|n|nao resolveu|continua|ainda)\b/.test(normalizedInput)) {
          edge = outgoing.find((candidate) => /^(nao|no)|not.?resolv|fail|continua|other/i.test(`${candidate.label || ''} ${candidate.sourcePort || ''}`));
        }
        if (!edge) {
          const state = await this.prisma.ticket.findUnique({ where: { id: ticketId }, select: { communicationFlowState: true } });
          const previousAttempts = (state?.communicationFlowState as unknown as CommunicationFlowState | null)?.attempts || 0;
          const attempts = previousAttempts + 1;
          if (attempts < (node.attempts || 3)) {
            if (node.errorMessage) createdMessages.push(await this.createFlowMessage(ticketId, node.errorMessage));
            await this.prisma.ticket.update({ where: { id: ticketId }, data: { communicationFlowState: { flowId: flow.id, currentNodeId: node.id, attempts, status: 'WAITING' } } });
            return createdMessages;
          }
          if (node.exhaustedMessage) createdMessages.push(await this.createFlowMessage(ticketId, node.exhaustedMessage));
          edge = outgoing.find((candidate) => candidate.target === node.fallbackTargetId)
            || outgoing.find((candidate) => /other|outro|default|fallback/i.test(`${candidate.sourcePort || ''} ${candidate.label || ''}`))
            || outgoing[0];
        }
        currentInput = undefined;
        nodeId = edge?.target;
        continue;
      }
      if (node.type === 'DIAGNOSE_CONNECTION') {
        try {
          const diagnostic = await this.diagnoseConnection({ id: 'flow-bot', email: '', name: 'Assistente virtual', role: UserRole.ADMIN } as AuthenticatedUser, ticketId);
          const onlineMatch = diagnostic.pppoe.summary.match(/(\d+)\s+de\s+(\d+)/i);
          const onlineCount = onlineMatch ? Number(onlineMatch[1]) : null;
          const connectionStatus = onlineCount === null
            ? 'não consegui confirmar o estado da conexão no sistema neste momento.'
            : onlineCount > 0
              ? 'consultei sua conexão no sistema e ela aparece conectada agora. Mesmo assim, pode haver uma falha no Wi-Fi ou nos equipamentos.'
              : 'consultei sua conexão no sistema e ela aparece desconectada neste momento.';
          const firstName = formatCustomerName(customerName).split(' ')[0];
          const invoices = diagnostic.billing.overdueInvoices ?? [];
          const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
          const dueDate = (value: string) => {
            const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
            return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
          };
          const invoiceMessage = invoices.length
            ? `\n\nTambém encontrei ${invoices.length === 1 ? 'um boleto vencido' : `${invoices.length} boletos vencidos`} no seu cadastro:\n${invoices.map((invoice) => {
              const paymentOptions = [invoice.linkPagamento ? `Segunda via: ${invoice.linkPagamento}` : null, invoice.linhaDigitavel ? `Linha digitável: ${invoice.linhaDigitavel}` : null].filter(Boolean).join('\n');
              return `• Vencimento: ${dueDate(invoice.dataVencimento)} — Valor em aberto: ${money.format(invoice.valorEmAberto)}${paymentOptions ? `\n${paymentOptions}` : '\nNão recebi a segunda via ou linha digitável deste boleto. O Financeiro pode ajudar a emitir.'}`;
            }).join('\n\n')}`
            : '';
          createdMessages.push(await this.createFlowMessage(ticketId, `${firstName}, ${connectionStatus}${invoiceMessage}\n\nVamos reiniciar os equipamentos para testar:\n1. Tire o modem/ONU e o roteador da tomada.\n2. Aguarde 30 segundos.\n3. Ligue primeiro o modem/ONU e espere as luzes estabilizarem.\n4. Ligue o roteador, aguarde alguns minutos e teste a internet novamente.`));
        } catch {
          const firstName = formatCustomerName(customerName).split(' ')[0];
          createdMessages.push(await this.createFlowMessage(ticketId, `${firstName}, não consegui confirmar o estado da conexão agora. Vamos reiniciar os equipamentos para testar:\n1. Tire o modem/ONU e o roteador da tomada.\n2. Aguarde 30 segundos.\n3. Ligue primeiro o modem/ONU e espere as luzes estabilizarem.\n4. Ligue o roteador, aguarde alguns minutos e teste a internet novamente.`));
        }
        nodeId = outgoing[0]?.target;
        continue;
      }
      if (node.type === 'TRANSFER') {
        const departmentMap: Record<string, TicketDepartment> = { COMMERCIAL: TicketDepartment.COMMERCIAL, FINANCE: TicketDepartment.FINANCE, SUPPORT_N1: TicketDepartment.SUPPORT_N1, SUPPORT_N2: TicketDepartment.SUPPORT_N2, FIELD: TicketDepartment.FIELD };
        const toDepartment = departmentMap[node.department || ''] || TicketDepartment.SUPPORT_N1;
        if (currentTicket.department !== toDepartment) {
          const bot = await this.flowBot();
          await this.prisma.ticketTransfer.create({
            data: {
              ticketId,
              fromDepartment: currentTicket.department,
              toDepartment,
              transferredById: bot.id,
              note: node.text || `Encaminhado automaticamente para ${toDepartment}.`,
            },
          });
          await this.prisma.ticket.update({ where: { id: ticketId }, data: { department: toDepartment } });
        }
        if (node.text) createdMessages.push(await this.createFlowMessage(ticketId, node.text));
        nodeId = outgoing[0]?.target;
        continue;
      }
      if (node.type === 'END') {
        if (node.text) createdMessages.push(await this.createFlowMessage(ticketId, node.text.replace(/\{\{nome_usuario\}\}/gi, formatCustomerName(customerName))));
        await this.prisma.ticket.update({ where: { id: ticketId }, data: { communicationFlowState: { flowId: flow.id, currentNodeId: node.id, attempts: 0, status: 'COMPLETED' } } });
        return createdMessages;
      }
      nodeId = outgoing[0]?.target;
    }
    await this.prisma.ticket.update({ where: { id: ticketId }, data: { communicationFlowState: { flowId: flow.id, currentNodeId: nodeId || firstNodeId, attempts: 0, status: 'COMPLETED' } } });
    return createdMessages;
  }

  private async advanceAssignedCommunicationFlow(ticketId: string, input: string) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId }, select: { status: true, assignedToId: true, communicationFlowState: true, customer: { select: { name: true } } } });
    const state = ticket?.communicationFlowState as unknown as CommunicationFlowState | null;
    if (!ticket || ticket.status !== TicketStatus.OPEN || ticket.assignedToId || !state || state.status !== 'WAITING') return [];
    const flow = await this.getAssignedPortalFlow();
    if (!flow || flow.id !== state.flowId) return [];
    return this.runCommunicationFlow(ticketId, flow, state.currentNodeId, ticket.customer.name, input);
  }

  /**
   * Lista os tickets visíveis ao usuário autenticado:
   * - CUSTOMER: apenas os próprios tickets
   * - AGENT/TECHNICIAN/ADMIN: todos os tickets (fila de atendimento)
   */
  async list(user: AuthenticatedUser) {
    const where = user.portalTicketId
      ? { id: user.portalTicketId }
      : user.role === UserRole.CUSTOMER ? { customerId: user.id } : {};
    return this.prisma.ticket.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        customer: { select: { id: true, name: true } },
        assignedTo: { select: { id: true, name: true } },
        ...(user.role !== UserRole.CUSTOMER && { transfers: { orderBy: { createdAt: 'desc' as const }, take: 1 } }),
      },
    });
  }

  async findOne(user: AuthenticatedUser, id: string) {
    if (user.portalTicketId && user.portalTicketId !== id) {
      throw new ForbiddenException('Você não tem acesso a este ticket');
    }
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, name: true } },
        assignedTo: { select: { id: true, name: true } },
        messages: { orderBy: { createdAt: 'asc' }, include: {
          author: { select: { id: true, name: true } },
          attachments: { select: { id: true, name: true, mimeType: true, size: true, createdAt: true } },
        } },
        ...(user.role !== UserRole.CUSTOMER && {
          transfers: { orderBy: { createdAt: 'asc' as const }, include: { transferredBy: { select: { id: true, name: true } }, transferredTo: { select: { id: true, name: true } } } },
        }),
      },
    });

    if (!ticket) {
      throw new NotFoundException('Ticket não encontrado');
    }

    if (user.role === UserRole.CUSTOMER && ticket.customerId !== user.id) {
      throw new ForbiddenException('Você não tem acesso a este ticket');
    }

    return ticket;
  }

  async ensurePortalFlowStarted(user: AuthenticatedUser, ticketId: string) {
    if (user.role !== UserRole.CUSTOMER) return [];
    const ticket = await this.findOne(user, ticketId);
    if (ticket.channel === 'PORTAL') {
      const state = ticket.communicationFlowState as unknown as CommunicationFlowState | null;
      if (state?.status === 'WAITING') {
        const flow = await this.getAssignedPortalFlow();
        const currentNode = flow?.nodes.find((node) => node.id === state.currentNodeId);
        if (flow?.id === state.flowId && currentNode?.type === 'DIAGNOSE_CONNECTION' && ticket.status === TicketStatus.OPEN && !ticket.assignedToId) {
          return this.runCommunicationFlow(ticketId, flow, currentNode.id, ticket.customer?.name || '');
        }
      }
      return this.startAssignedCommunicationFlow(ticketId);
    }
    return [];
  }

  async diagnoseConnection(user: AuthenticatedUser, ticketId: string): Promise<ConnectionDiagnostic> {
    if (![UserRole.ADMIN, UserRole.AGENT, UserRole.TECHNICIAN].includes(user.role)) {
      throw new ForbiddenException('Somente a equipe de atendimento pode executar o diagnóstico');
    }
    const ticket = await this.findOne(user, ticketId);
    if (ticket.category !== TicketCategory.CONNECTION_DOWN) {
      throw new BadRequestException('O diagnóstico automático está disponível para chamados sem conexão');
    }
    if (!ticket.ixcCustomerId) {
      throw new BadRequestException('Este chamado não está vinculado a um cadastro do IXC');
    }

    const customer = await this.ixcService.getCustomerByIxcId(ticket.ixcCustomerId);
    const logins = customer.cadastrosIxc.flatMap((registration) => [
      ...registration.contratos.flatMap((contract) => contract.logins),
      ...registration.loginsSemContrato,
    ]);
    const overdue = customer.financeiro.contasVencidas ?? 0;
    const openInvoices = customer.financeiro.contasEmAberto ?? 0;
    const financeBlocked = customer.cadastrosIxc.some((registration) => registration.contratos.some((contract) =>
      /bloqueio|financeir|atraso/i.test(contract.situacaoInternet ?? '')));

    const billingStatus = !customer.financeiro.disponivel
      ? 'UNAVAILABLE' as const
      : overdue > 0 || financeBlocked ? 'WARNING' as const : 'OK' as const;
    const billingDetails = customer.financeiro.disponivel
      ? [`${openInvoices} conta(s) em aberto; ${overdue} vencida(s).`, ...(financeBlocked ? ['O IXC indica bloqueio ou atraso no status de internet.'] : [])]
      : ['O usuário da API do IXC não permitiu consultar o financeiro.'];

    const onlineLogins = logins.filter((login) => login.online === 'Sim');
    const knownOnlineStates = logins.filter((login) => login.online === 'Sim' || login.online === 'Não');
    const activeLogins = logins.filter((login) => login.ativo === 'Sim');
    const allActiveOffline = activeLogins.length > 0
      && activeLogins.every((login) => login.online === 'Não');
    const pppoeStatus = logins.length === 0 || knownOnlineStates.length === 0
      ? 'UNAVAILABLE' as const
      : allActiveOffline ? 'WARNING' as const : 'OK' as const;
    const pppoeDetails = logins.length
      ? [...logins.slice(0, 8).map((login) => `${login.login || 'Login sem nome'}: ${login.ativo === 'Sim' ? 'ativo' : login.ativo === 'Não' ? 'inativo' : 'status desconhecido'}, ${login.online === 'Sim' ? 'online' : login.online === 'Não' ? 'offline' : 'conexão sem status'}.`), ...(logins.length > 8 ? [`Mais ${logins.length - 8} login(s) não exibidos.`] : [])]
      : ['Nenhum login PPPoE foi localizado no cadastro IXC.'];

    const signalReadings = logins.flatMap((login) => {
      if (!login.onu.sinalRx) return [];
      const match = login.onu.sinalRx.match(/-?\d+(?:[.,]\d+)?/);
      const value = match ? Number(match[0].replace(',', '.')) : NaN;
      return Number.isFinite(value) ? [{ login: login.login, value, raw: login.onu.sinalRx }] : [];
    });
    const lowestRx = signalReadings.length ? Math.min(...signalReadings.map((reading) => reading.value)) : null;
    const opticalStatus = lowestRx === null
      ? 'UNAVAILABLE' as const
      : lowestRx < -30 ? 'CRITICAL' as const
        : lowestRx < -27 ? 'WARNING' as const : 'OK' as const;
    const opticalDetails = signalReadings.length
      ? [...signalReadings.slice(0, 6).map((reading) => `${reading.login || 'Login'}: RX ${reading.raw}.`), ...(signalReadings.length > 6 ? [`Mais ${signalReadings.length - 6} leitura(s) não exibida(s).`] : [])]
      : ['Não há leitura recente de potência RX disponível no IXC.'];
    if (lowestRx !== null) opticalDetails.push('Referência automática: abaixo de -30 dBm é crítico; abaixo de -27 dBm requer atenção. Confirme os limites usados pela sua rede.');

    const since = new Date(Date.now() - 30 * 60 * 1000);
    const recentConnectionTickets = await this.prisma.ticket.count({
      where: {
        category: TicketCategory.CONNECTION_DOWN,
        status: { in: [TicketStatus.OPEN, TicketStatus.IN_PROGRESS, TicketStatus.WAITING_CUSTOMER] },
        createdAt: { gte: since },
      },
    });
    const possibleIncident = recentConnectionTickets >= 3;
    const incidentDetails = [`${recentConnectionTickets} chamado(s) de sem conexão aberto(s) nos últimos 30 minutos, em toda a operação.`];
    if (possibleIncident) incidentDetails.push('Volume elevado pode indicar incidente coletivo. A região não é comparada automaticamente; confirme a localidade antes de abrir visita técnica.');
    const facts: Record<string, boolean | number | null> = {
      POSSIBLE_INCIDENT: possibleIncident,
      OVERDUE_INVOICES: customer.financeiro.disponivel ? overdue : null,
      ALL_ACTIVE_OFFLINE: activeLogins.length > 0 && activeLogins.every((login) => login.online === 'Não')
        ? true
        : activeLogins.length > 0 && activeLogins.every((login) => login.online === 'Sim' || login.online === 'Não') ? false : null,
      RX_DBM: lowestRx,
      ANY_PPPOE_ONLINE: !logins.length || knownOnlineStates.length !== logins.length
        ? onlineLogins.length ? true : null
        : onlineLogins.length > 0,
    };
    const settings = await this.prisma.systemSettings.findUnique({ where: { id: 'global' }, select: { diagnosticFlow: true } });
    const storedFlow = Array.isArray(settings?.diagnosticFlow) ? settings.diagnosticFlow as unknown as DiagnosticFlowRule[] : [];
    const flow = storedFlow.length ? storedFlow : DEFAULT_DIAGNOSTIC_FLOW;
    const matches = (rule: DiagnosticFlowRule) => {
      if (!rule.enabled) return false;
      const fact = facts[rule.field];
      if (rule.operator === 'IS_TRUE') return fact === true;
      if (rule.operator === 'IS_FALSE') return fact === false;
      if (typeof fact !== 'number' || typeof rule.threshold !== 'number') return false;
      const operations: Record<DiagnosticFlowOperator, (value: number, threshold: number) => boolean> = {
        IS_TRUE: () => false,
        IS_FALSE: () => false,
        GT: (value, threshold) => value > threshold,
        GTE: (value, threshold) => value >= threshold,
        LT: (value, threshold) => value < threshold,
        LTE: (value, threshold) => value <= threshold,
      };
      return operations[rule.operator](fact, rule.threshold);
    };
    const matchedRule = flow.find(matches) ?? null;
    const routeDepartment = matchedRule?.department ?? TicketDepartment.SUPPORT_N1;
    const recommendation: ConnectionDiagnostic['recommendation'] = matchedRule?.field === 'POSSIBLE_INCIDENT' && possibleIncident
      ? 'POSSIBLE_INCIDENT'
      : routeDepartment === TicketDepartment.FINANCE ? 'FINANCE'
        : routeDepartment === TicketDepartment.FIELD ? 'FIELD'
          : routeDepartment === TicketDepartment.SUPPORT_N2 ? 'N2' : 'N1';
    const recommendationText = matchedRule?.message
      ?? 'Nenhuma regra foi atendida. Continue a triagem no Suporte N1 e revise o fluxo configurado.';

    return {
      customerName: customer.razaoSocial,
      checkedAt: new Date().toISOString(),
      recommendation,
      recommendationText,
      routeDepartment,
      matchedRule: matchedRule?.name ?? null,
      billing: {
        status: billingStatus,
        summary: !customer.financeiro.disponivel ? 'Financeiro indisponível' : overdue > 0 ? `${overdue} conta(s) vencida(s)` : financeBlocked ? 'Bloqueio/atraso indicado pelo IXC' : 'Sem contas vencidas',
        details: billingDetails,
      },
      pppoe: {
        status: pppoeStatus,
        summary: !logins.length ? 'Nenhum login localizado' : `${onlineLogins.length} de ${logins.length} login(s) online`,
        details: pppoeDetails,
      },
      optical: {
        status: opticalStatus,
        summary: lowestRx === null ? 'Sinal óptico indisponível' : `Menor RX: ${lowestRx} dBm`,
        details: opticalDetails,
      },
      incident: {
        status: possibleIncident ? 'WARNING' : 'OK',
        summary: possibleIncident ? 'Possível aumento de chamados' : 'Sem aumento de chamados detectado',
        details: incidentDetails,
      },
    };
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateTicketDto) {
    // Garante que o ticket existe e que o solicitante tem acesso a ele.
    const currentTicket = await this.findOne(user, id);

    if (user.role === UserRole.CUSTOMER) {
      throw new ForbiddenException('Clientes não podem alterar o status do ticket');
    }

    if (dto.assignedToId) {
      const assignee = await this.prisma.user.findUnique({ where: { id: dto.assignedToId }, select: { role: true, isActive: true } });
      if (!assignee || !assignee.isActive || (assignee.role !== UserRole.AGENT && assignee.role !== UserRole.TECHNICIAN && assignee.role !== UserRole.ADMIN)) {
        throw new ForbiddenException('O responsável precisa fazer parte da equipe de atendimento');
      }
    }

    const departmentChanged = dto.department !== undefined && dto.department !== currentTicket.department;
    const recipientChanged = dto.assignedToId !== undefined && dto.assignedToId !== currentTicket.assignedToId;
    const flowState = currentTicket.communicationFlowState as unknown as CommunicationFlowState | null;
    const stopFlow = !!dto.assignedToId && !currentTicket.assignedToId && flowState?.status === 'WAITING';
    return this.prisma.$transaction(async (transaction) => {
      if (departmentChanged || recipientChanged) {
        await transaction.ticketTransfer.create({
          data: {
            ticketId: id,
            fromDepartment: currentTicket.department,
            toDepartment: dto.department ?? currentTicket.department,
            transferredById: user.id,
            transferredToId: dto.assignedToId || null,
            note: dto.transferNote?.trim() || null,
          },
        });
      }
      const updatedTicket = await transaction.ticket.update({
        where: { id },
        data: {
          status: dto.status,
          priority: dto.priority,
          assignedToId: departmentChanged ? (dto.assignedToId ?? null) : dto.assignedToId,
          department: dto.department,
          ...(stopFlow && flowState ? { communicationFlowState: { ...flowState, status: 'STOPPED' } } : {}),
        },
        include: {
          customer: { select: { id: true, name: true } },
          assignedTo: { select: { id: true, name: true } },
          transfers: { orderBy: { createdAt: 'asc' }, include: { transferredBy: { select: { id: true, name: true } }, transferredTo: { select: { id: true, name: true } } } },
        },
      });
      const closureMessage = dto.status === TicketStatus.CLOSED && currentTicket.status !== TicketStatus.CLOSED
        ? await transaction.ticketMessage.create({
            data: {
              ticketId: id,
              authorId: user.id,
              message: 'Este atendimento foi encerrado. Como foi sua experiência? Avalie o atendimento abaixo.',
            },
            include: { author: { select: { id: true, name: true } } },
          })
        : null;
      return { ...updatedTicket, closureMessage };
    });
  }

  async submitSatisfaction(user: AuthenticatedUser, id: string, dto: SubmitSatisfactionDto) {
    const ticket = await this.findOne(user, id);
    if (user.role !== UserRole.CUSTOMER) throw new ForbiddenException('Somente o cliente pode avaliar o atendimento');
    if (ticket.status !== TicketStatus.CLOSED) throw new BadRequestException('A avaliação fica disponível após o encerramento do atendimento');
    const result = await this.prisma.ticket.updateMany({
      where: { id, customerId: user.id, status: TicketStatus.CLOSED, satisfactionSubmittedAt: null },
      data: {
        satisfactionRating: dto.rating,
        satisfactionComment: dto.comment?.trim() || null,
        satisfactionSubmittedAt: new Date(),
      },
    });
    if (!result.count) throw new BadRequestException('Este atendimento já foi avaliado');
    return this.findOne(user, id);
  }

  async addMessage(user: AuthenticatedUser, ticketId: string, message: string) {
    const ticket = await this.findOne(user, ticketId);
    if (ticket.status === TicketStatus.CLOSED) {
      throw new BadRequestException('Este atendimento foi encerrado e não aceita novas mensagens');
    }
    const isSupport = [UserRole.ADMIN, UserRole.AGENT, UserRole.TECHNICIAN].includes(user.role);
    const currentStatus = String(ticket.status);
    const nextStatus = isSupport && (currentStatus === 'OPEN' || currentStatus === 'WAITING_CUSTOMER')
      ? TicketStatus.IN_PROGRESS
      : user.role === UserRole.CUSTOMER && currentStatus === 'WAITING_CUSTOMER'
        ? TicketStatus.OPEN
        : null;
    const flowState = ticket.communicationFlowState as unknown as CommunicationFlowState | null;
    const stopFlow = isSupport && !ticket.assignedToId && flowState?.status === 'WAITING';

    const result = await this.prisma.$transaction(async (transaction) => {
      const createdMessage = await transaction.ticketMessage.create({
        data: { ticketId, authorId: user.id, message },
        include: { author: { select: { id: true, name: true } } },
      });

      const updatedTicket = nextStatus
        ? await transaction.ticket.update({
            where: { id: ticketId },
            data: {
              status: nextStatus,
              ...(isSupport && { assignedToId: ticket.assignedToId ?? user.id }),
              ...(stopFlow && flowState ? { communicationFlowState: { ...flowState, status: 'STOPPED' } } : {}),
            },
          })
        : null;

      return { message: createdMessage, updatedTicket };
    });
    let flowMessages: Awaited<ReturnType<TicketsService['createFlowMessage']>>[] = [];
    if (user.role === UserRole.CUSTOMER && ticket.channel === 'PORTAL') {
      // Chamados antigos podem estar abertos na tela do celular desde antes de
      // a associação do canal ao fluxo existir; iniciar também na próxima mensagem.
      flowMessages = await this.withCommunicationFlowLock(ticketId, async () => {
        await this.startAssignedCommunicationFlow(ticketId);
        return this.advanceAssignedCommunicationFlow(ticketId, message);
      });
    }
    const flowUpdatedTicket = user.role === UserRole.CUSTOMER && ticket.channel === 'PORTAL'
      ? await this.findOne(user, ticketId)
      : null;
    return { ...result, updatedTicket: flowUpdatedTicket ?? result.updatedTicket, flowMessages };
  }

  async addAttachment(user: AuthenticatedUser, ticketId: string, file: Express.Multer.File, messageText = '') {
    const ticket = await this.findOne(user, ticketId);
    if (ticket.status === TicketStatus.CLOSED) {
      throw new BadRequestException('Este atendimento foi encerrado e não aceita novas mensagens');
    }
    const safeName = file.originalname
      .replace(/[\\/\u0000-\u001f\u007f]/g, '_')
      .trim()
      .slice(0, 255) || 'arquivo';
    return this.prisma.ticketMessage.create({
      data: {
        ticketId,
        authorId: user.id,
        message: messageText.trim(),
        attachments: {
          create: {
            name: safeName,
            mimeType: file.mimetype,
            size: file.size,
            storageName: file.filename,
          },
        },
      },
      include: {
        author: { select: { id: true, name: true } },
        attachments: { select: { id: true, name: true, mimeType: true, size: true, createdAt: true } },
      },
    });
  }

  async getAttachment(user: AuthenticatedUser, ticketId: string, attachmentId: string) {
    await this.findOne(user, ticketId);
    const attachment = await this.prisma.ticketAttachment.findFirst({
      where: { id: attachmentId, message: { is: { ticketId } } },
    });
    if (!attachment) throw new NotFoundException('Arquivo não encontrado');
    return attachment;
  }
}
