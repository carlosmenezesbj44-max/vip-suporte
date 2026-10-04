import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TicketDepartment } from '@prisma/client';
import { DEFAULT_DIAGNOSTIC_FLOW, DiagnosticFlowField, DiagnosticFlowOperator, DiagnosticFlowRule } from '@canal-direto/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CreateChannelDto } from './dto/create-channel.dto';
import { UpdateChannelDto } from './dto/update-channel.dto';
import { UpdateGeneralSettingsDto } from './dto/update-general-settings.dto';
import { UpdateSecuritySettingsDto } from './dto/update-security-settings.dto';
import { UpdateDiagnosticFlowDto } from './dto/update-diagnostic-flow.dto';

const SETTINGS_ID = 'global';

const DEFAULT_COMMUNICATION_FLOWS = [{
  id: 'entry-main', name: '1- Entrada', country: 'Brasil', intent: 'Boas-vindas e direcionamento inicial', enabled: true,
  nodes: [
    { id: 'start', type: 'START', title: 'Entrada do atendimento', text: 'Quando o cliente inicia uma conversa', x: 265, y: 35 },
    { id: 'welcome', type: 'SEND_MESSAGE', title: 'Enviar mensagem', text: 'Olá, {{nome_usuario}}! Bem-vindo à {{nome_empresa}}. Como podemos ajudar?', messageKind: 'TEXT', x: 180, y: 180 },
    { id: 'intent', type: 'IDENTIFY_INTENT', title: 'Identificar intenção', text: 'O que você precisa resolver hoje?', errorMessage: 'Não consegui identificar sua solicitação. Escolha uma das opções abaixo.', attempts: 3, exhaustedMessage: 'Vou encaminhar você para um atendente.', fallbackFlowId: '', x: 180, y: 390 },
    { id: 'diagnose', type: 'DIAGNOSE_CONNECTION', title: 'Diagnóstico de conexão', text: 'Verificar financeiro, PPPoE, ONU e incidentes antes de encaminhar.', x: 10, y: 650 },
    { id: 'finance', type: 'TRANSFER', title: 'Encaminhar ao Financeiro', department: 'FINANCE', text: 'Direcionar conversa para Financeiro.', x: 330, y: 650 },
    { id: 'support', type: 'TRANSFER', title: 'Encaminhar ao Suporte N1', department: 'SUPPORT_N1', text: 'Direcionar conversa para Suporte N1.', x: 650, y: 650 },
  ],
  edges: [
    { id: 'e-start-welcome', source: 'start', target: 'welcome', sourcePort: 'next', label: '' },
    { id: 'e-welcome-intent', source: 'welcome', target: 'intent', sourcePort: 'next', label: '' },
    { id: 'e-intent-diagnose', source: 'intent', target: 'diagnose', sourcePort: 'internet', label: 'Sem internet' },
    { id: 'e-intent-finance', source: 'intent', target: 'finance', sourcePort: 'finance', label: 'Financeiro' },
    { id: 'e-intent-support', source: 'intent', target: 'support', sourcePort: 'other', label: 'Outros assuntos' },
  ],
}];

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  private async ensureSettings() {
    return this.prisma.systemSettings.upsert({ where: { id: SETTINGS_ID }, create: { id: SETTINGS_ID }, update: {} });
  }

  async getSettings() {
    const [settings, channels] = await Promise.all([
      this.ensureSettings(),
      this.prisma.supportChannel.findMany({ orderBy: [{ type: 'asc' }, { name: 'asc' }] }),
    ]);
    return {
      general: {
        companyName: settings.companyName,
        supportEmail: settings.supportEmail,
        supportPhone: settings.supportPhone,
        timezone: settings.timezone,
      },
      security: {
        passwordMinLength: settings.passwordMinLength,
        sessionDurationDays: settings.sessionDurationDays,
      },
      diagnosticFlow: Array.isArray(settings.diagnosticFlow) && settings.diagnosticFlow.length
        ? settings.diagnosticFlow as unknown as DiagnosticFlowRule[]
        : DEFAULT_DIAGNOSTIC_FLOW,
      communicationFlows: Array.isArray(settings.communicationFlows) && settings.communicationFlows.length
        ? settings.communicationFlows as unknown as Record<string, unknown>[]
        : DEFAULT_COMMUNICATION_FLOWS,
      channelFlowAssignments: settings.channelFlowAssignments && typeof settings.channelFlowAssignments === 'object'
        ? settings.channelFlowAssignments as Record<string, string>
        : {},
      channels,
    };
  }

  async getDiagnosticFlow() {
    const settings = await this.ensureSettings();
    return {
      rules: Array.isArray(settings.diagnosticFlow) && settings.diagnosticFlow.length
        ? settings.diagnosticFlow as unknown as DiagnosticFlowRule[]
        : DEFAULT_DIAGNOSTIC_FLOW,
    };
  }

  async getCommunicationFlows() {
    const settings = await this.ensureSettings();
    return { flows: Array.isArray(settings.communicationFlows) && settings.communicationFlows.length
      ? settings.communicationFlows as unknown as Record<string, unknown>[]
      : DEFAULT_COMMUNICATION_FLOWS };
  }

  async updateCommunicationFlows(body: { flows: unknown[] }) {
    if (!Array.isArray(body?.flows) || body.flows.length < 1 || body.flows.length > 100) {
      throw new BadRequestException('Informe de 1 a 100 fluxos de comunicação');
    }
    const ids = body.flows.map((flow: any) => flow?.id);
    if (ids.some((id) => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) {
      throw new BadRequestException('Cada fluxo precisa ter um identificador exclusivo');
    }
    for (const flow of body.flows as any[]) {
      if (typeof flow.name !== 'string' || !flow.name.trim() || !Array.isArray(flow.nodes) || !Array.isArray(flow.edges)) {
        throw new BadRequestException('Cada fluxo precisa de nome, etapas e conexões');
      }
      const nodeIds = flow.nodes.map((node: any) => node?.id);
      if (nodeIds.some((id: unknown) => typeof id !== 'string' || !id) || new Set(nodeIds).size !== nodeIds.length) {
        throw new BadRequestException(`O fluxo “${flow.name}” contém etapas sem identificador exclusivo`);
      }
      if (!flow.nodes.some((node: any) => node.type === 'START')) {
        throw new BadRequestException(`O fluxo “${flow.name}” precisa ter uma etapa de entrada`);
      }
      if (flow.edges.some((edge: any) => !nodeIds.includes(edge.source) || !nodeIds.includes(edge.target))) {
        throw new BadRequestException(`O fluxo “${flow.name}” contém conexão com etapa inexistente`);
      }
    }
    await this.ensureSettings();
    const updated = await this.prisma.systemSettings.update({
      where: { id: SETTINGS_ID }, data: { communicationFlows: body.flows as Prisma.InputJsonValue },
      select: { communicationFlows: true },
    });
    return { flows: updated.communicationFlows as unknown as Record<string, unknown>[] };
  }

  async updateChannelFlowAssignments(body: { assignments: Record<string, string | null> }) {
    if (!body?.assignments || typeof body.assignments !== 'object' || Array.isArray(body.assignments)) {
      throw new BadRequestException('Informe a associação entre canais e fluxos');
    }
    const [settings, channels] = await Promise.all([
      this.ensureSettings(),
      this.prisma.supportChannel.findMany({ select: { id: true } }),
    ]);
    const allowedChannelIds = new Set(['PORTAL', ...channels.map((channel) => channel.id)]);
    const flows = Array.isArray(settings.communicationFlows) && settings.communicationFlows.length
      ? settings.communicationFlows as unknown as Array<{ id: string; enabled?: boolean }>
      : DEFAULT_COMMUNICATION_FLOWS;
    const enabledFlowIds = new Set(flows.filter((flow) => flow.enabled !== false).map((flow) => flow.id));
    for (const [channelId, flowId] of Object.entries(body.assignments)) {
      if (!allowedChannelIds.has(channelId)) throw new BadRequestException('Um dos canais selecionados não existe');
      if (flowId !== null && (typeof flowId !== 'string' || !enabledFlowIds.has(flowId))) {
        throw new BadRequestException('Selecione um fluxo ativo existente para cada canal');
      }
    }
    const updated = await this.prisma.systemSettings.update({
      where: { id: SETTINGS_ID },
      data: { channelFlowAssignments: body.assignments as Prisma.InputJsonValue },
      select: { channelFlowAssignments: true },
    });
    return { assignments: updated.channelFlowAssignments as Record<string, string | null> };
  }

  async updateDiagnosticFlow(dto: UpdateDiagnosticFlowDto) {
    await this.ensureSettings();
    const ids = dto.rules.map((rule) => rule.id);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('Cada etapa precisa ter um identificador exclusivo');
    const booleanFields: DiagnosticFlowField[] = ['POSSIBLE_INCIDENT', 'ALL_ACTIVE_OFFLINE', 'ANY_PPPOE_ONLINE'];
    const numericOperators: DiagnosticFlowOperator[] = ['GT', 'GTE', 'LT', 'LTE'];
    for (const rule of dto.rules) {
      const isBooleanField = booleanFields.includes(rule.field as DiagnosticFlowField);
      if (isBooleanField && !['IS_TRUE', 'IS_FALSE'].includes(rule.operator)) {
        throw new BadRequestException(`A condição “${rule.name}” precisa comparar verdadeiro ou falso`);
      }
      if (!isBooleanField && (!numericOperators.includes(rule.operator as DiagnosticFlowOperator) || !Number.isFinite(rule.threshold))) {
        throw new BadRequestException(`A condição “${rule.name}” precisa de uma comparação numérica e um limite válido`);
      }
    }
    const rules = dto.rules.map((rule) => ({
      ...rule,
      field: rule.field as DiagnosticFlowField,
      operator: rule.operator as DiagnosticFlowOperator,
      department: rule.department as TicketDepartment,
      threshold: rule.threshold ?? null,
    }));
    const updated = await this.prisma.systemSettings.update({
      where: { id: SETTINGS_ID },
      data: { diagnosticFlow: rules as Prisma.InputJsonValue },
      select: { diagnosticFlow: true },
    });
    return { rules: updated.diagnosticFlow as unknown as DiagnosticFlowRule[] };
  }

  async updateGeneral(dto: UpdateGeneralSettingsDto) {
    await this.ensureSettings();
    const data = { ...dto };
    if (dto.supportPhone !== undefined) data.supportPhone = dto.supportPhone.replace(/[^+\d]/g, '');
    return this.prisma.systemSettings.update({
      where: { id: SETTINGS_ID }, data,
      select: { companyName: true, supportEmail: true, supportPhone: true, timezone: true },
    });
  }

  async updateSecurity(dto: UpdateSecuritySettingsDto) {
    await this.ensureSettings();
    return this.prisma.systemSettings.update({
      where: { id: SETTINGS_ID }, data: dto,
      select: { passwordMinLength: true, sessionDurationDays: true },
    });
  }

  async getSecurity() {
    const settings = await this.ensureSettings();
    return { passwordMinLength: settings.passwordMinLength, sessionDurationDays: settings.sessionDurationDays };
  }

  async createChannel(dto: CreateChannelDto) {
    return this.prisma.supportChannel.create({ data: { ...dto, enabled: dto.enabled ?? true } });
  }

  async updateChannel(id: string, dto: UpdateChannelDto) {
    const exists = await this.prisma.supportChannel.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException('Canal não encontrado');
    return this.prisma.supportChannel.update({ where: { id }, data: dto });
  }
}
