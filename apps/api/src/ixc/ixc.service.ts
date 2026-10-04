import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import axios, { AxiosInstance } from 'axios';
import { IxcCustomer, IxcLogin } from '@canal-direto/shared';
import { PrismaService } from '../prisma/prisma.service';

export interface UpdateIxcConfiguration {
  baseUrl: string;
  token?: string;
  clearToken?: boolean;
}

type IxcRecord = Record<string, unknown>;

function recordText(record: IxcRecord, field: string): string {
  const value = record[field];
  return value === null || value === undefined ? '' : String(value).trim();
}

function addressFrom(record: IxcRecord): string {
  const street = [recordText(record, 'endereco'), recordText(record, 'numero')].filter(Boolean).join(', ');
  const neighborhood = recordText(record, 'bairro');
  const city = recordText(record, 'cidade');
  const cep = recordText(record, 'cep');
  return [street, neighborhood, city, cep ? `CEP ${cep}` : ''].filter(Boolean).join(' · ');
}

function moneyValue(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const raw = String(value ?? '').trim();
  if (!raw) return 0;
  const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
  const parsed = Number(normalized.replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

@Injectable()
export class IxcService {
  private readonly logger = new Logger(IxcService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  private encryptionKey() {
    const secret = this.configService.get<string>('SETTINGS_ENCRYPTION_KEY')
      || this.configService.get<string>('JWT_SECRET')
      || 'dev-secret';
    return createHash('sha256').update(secret, 'utf8').digest();
  }

  private encrypt(value: string) {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey(), nonce);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return [nonce, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64')).join('.');
  }

  private decrypt(value: string) {
    const [noncePart, tagPart, encryptedPart] = value.split('.');
    if (!noncePart || !tagPart || !encryptedPart) throw new Error('Credencial IXC armazenada em formato inválido');
    const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey(), Buffer.from(noncePart, 'base64'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedPart, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  private envCredential() {
    const value = this.configService.get<string>('IXC_API_TOKEN')?.trim() ?? '';
    if (value.startsWith('Basic ')) {
      try { return Buffer.from(value.slice('Basic '.length).trim(), 'base64').toString('utf8'); }
      catch { return ''; }
    }
    return value;
  }

  private isCredentialConfigured(credential: string) {
    const pieces = credential.split(':');
    const complete = pieces.length >= 2 && pieces[0].trim().length > 0 && pieces.slice(1).join(':').trim().length > 0;
    return complete && !/(?:SEU_TOKEN|TOKEN_NOVO|ID_DO_USUARIO|PLACEHOLDER|CHANGE_ME|token-base64-do-ixc)/i.test(credential);
  }

  private async getConfiguration() {
    const saved = await this.prisma.ixcConfiguration.findUnique({ where: { id: 'primary' } });
    if (saved) return { baseUrl: saved.baseUrl, credential: this.decrypt(saved.encryptedCredential), source: 'database' as const };
    return {
      baseUrl: this.configService.get<string>('IXC_API_URL')?.trim() ?? '',
      credential: this.envCredential(),
      source: 'environment' as const,
    };
  }

  private apiClient(baseUrl: string, credential: string): AxiosInstance {
    const encodedCredential = credential.startsWith('Basic ')
      ? credential.slice('Basic '.length).trim()
      : Buffer.from(credential, 'utf8').toString('base64');
    return axios.create({
      baseURL: baseUrl,
      timeout: 12000,
      headers: {
        Authorization: `Basic ${encodedCredential}`,
        'Content-Type': 'application/json',
        ixcsoft: 'listar',
      },
    });
  }

  /** Retorna metadados sem devolver a credencial ou qualquer parte dela. */
  async getConfigurationStatus() {
    const config = await this.getConfiguration();
    return {
      baseUrl: config.baseUrl || null,
      tokenConfigured: this.isCredentialConfigured(config.credential),
      source: config.source,
    };
  }

  async saveConfiguration(dto: UpdateIxcConfiguration) {
    const baseUrl = dto.baseUrl.trim().replace(/\/+$/, '');
    let parsed: URL;
    try { parsed = new URL(baseUrl); }
    catch { throw new BadRequestException('Informe uma URL válida para o webservice do IXC'); }
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))) {
      throw new BadRequestException('A URL do IXC precisa usar HTTPS');
    }
    if (!baseUrl.endsWith('/webservice/v1')) {
      throw new BadRequestException('A URL deve terminar com /webservice/v1');
    }

    const current = await this.getConfiguration();
    let credential = dto.clearToken ? '' : (dto.token?.trim() || current.credential);
    if (credential.startsWith('Basic ')) credential = Buffer.from(credential.slice(6).trim(), 'base64').toString('utf8');
    if (credential && !this.isCredentialConfigured(credential)) {
      throw new BadRequestException('Informe a credencial IXC no formato ID_DO_USUARIO:TOKEN');
    }
    if (!credential) {
      throw new BadRequestException('Informe uma credencial antes de salvar a integração');
    }

    await this.prisma.ixcConfiguration.upsert({
      where: { id: 'primary' },
      create: { id: 'primary', baseUrl, encryptedCredential: this.encrypt(credential) },
      update: { baseUrl, encryptedCredential: this.encrypt(credential) },
    });
    return this.getConfigurationStatus();
  }

  async testConnection() {
    const config = await this.getConfiguration();
    if (!config.baseUrl || !this.isCredentialConfigured(config.credential)) {
      return { connected: false, message: 'Configure a URL e a credencial do IXC antes de testar.' };
    }
    try {
      await this.apiClient(config.baseUrl, config.credential).post('/cliente', {
        qtype: 'cliente.id', query: '-1', oper: '=', page: '1', rp: '1',
      });
      return { connected: true, message: 'O IXC respondeu à consulta de teste.' };
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      const message = status === 401 || status === 403
        ? 'O IXC recusou a credencial. Confira o ID e o token.'
        : status ? `O IXC respondeu com erro HTTP ${status}.` : 'Não foi possível alcançar o webservice do IXC.';
      return { connected: false, message };
    }
  }

  /** Busca um cliente por CPF/CNPJ; falhas não bloqueiam a abertura do chamado. */
  async findCustomerByDocument(cpfCnpj: string): Promise<IxcCustomer | null> {
    try {
      return await this.searchCustomerByDocument(cpfCnpj);
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      this.logger.warn(`Falha ao consultar cliente no IXC${status ? ` (HTTP ${status})` : ''}`);
      return null;
    }
  }

  /** Busca no painel por CPF, telefone ou nome e reúne cadastros que compartilham o mesmo CPF. */
  async searchCustomers(searchTerm: string): Promise<IxcCustomer[]> {
    const term = searchTerm.trim();
    if (term.length < 3 || term.length > 100) {
      throw new BadRequestException('Digite pelo menos 3 caracteres para pesquisar');
    }

    const digits = term.replace(/\D/g, '');
    // Normalize common Brazilian dialing prefixes before searching IXC. The number
    // may be typed with +55, or copied with the carrier prefix (0XX).
    let phoneDigits = (digits.length === 12 || digits.length === 13) && digits.startsWith('55') ? digits.slice(2) : digits;
    if ((phoneDigits.length === 12 || phoneDigits.length === 13) && phoneDigits.startsWith('0')) {
      phoneDigits = phoneDigits.slice(-11);
    }
    const explicitCpf = /^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(term);
    const explicitCnpj = /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/.test(term);
    // Nomes completos contêm espaços; só classificamos uma busca formatada
    // como telefone quando ela não contém letras.
    const hasLetters = /\p{L}/u.test(term);
    const phoneFormatted = !hasLetters && /[()+\-\s]/.test(term) && !explicitCpf && !explicitCnpj;
    const isNumeric = /^\d+$/.test(term);
    const isDocument = explicitCpf || explicitCnpj
      || (isNumeric && digits.length === 14)
      || (isNumeric && digits.length === 11 && this.isValidCpf(digits));

    // An 11-digit mobile number can coincidentally pass the CPF checksum. Keep
    // both interpretations so that a valid phone is not mistaken for a document.
    const ambiguousCpfAndPhone = isNumeric && digits.length === 11 && this.isValidCpf(digits);
    if (isDocument && !ambiguousCpfAndPhone) {
      const customer = await this.searchCustomerByDocument(digits);
      return customer ? [customer] : [];
    }

    const isPhone = !hasLetters && (phoneFormatted || (isNumeric && (digits.length === 10 || digits.length === 11))
      || (digits.length >= 8 && digits.length === term.length));
    if (isPhone && phoneDigits.length < 8) {
      throw new BadRequestException('Digite pelo menos 8 números do telefone');
    }
    if (isNumeric && !isPhone) {
      throw new BadRequestException('Digite um CPF válido, pelo menos 8 números do telefone ou um nome');
    }

    const config = await this.getConfiguration();
    if (!config.baseUrl || !this.isCredentialConfigured(config.credential)) {
      throw new ServiceUnavailableException('A integração IXC ainda não está configurada');
    }

    try {
      const api = this.apiClient(config.baseUrl, config.credential);
      const listCustomers = async (field: string, query: string) => {
        const response = await api.post('/cliente', {
          qtype: `cliente.${field}`, query, oper: 'L', page: '1', rp: '100',
        });
        return Array.isArray(response.data?.registros) ? response.data.registros as IxcRecord[] : [];
      };
      let candidates: IxcRecord[];
      if (isPhone) {
        const areaCode = phoneDigits.slice(0, 2);
        const subscriber = phoneDigits.length === 11
          ? `${phoneDigits.slice(2, 7)}-${phoneDigits.slice(7)}`
          : `${phoneDigits.slice(2, 6)}-${phoneDigits.slice(6)}`;
        const formatted = `(${areaCode}) ${subscriber}`;
        // IXC fields are not always formatted consistently. Searching the last
        // 7 digits also finds entries where punctuation or country code differs;
        // candidates are checked against their normalized phone before returning.
        const variants = [...new Set([
          term,
          digits,
          phoneDigits,
          formatted,
          phoneDigits.slice(-10),
          phoneDigits.slice(-7),
        ].filter((value) => value.length >= 7))];
        const fields = ['telefone_celular', 'whatsapp', 'fone', 'telefone_comercial'];
        const results = await Promise.allSettled(fields.flatMap((field) => variants.map((variant) => listCustomers(field, variant))));
        candidates = results.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
        if (!candidates.length && results.every((result) => result.status === 'rejected')) {
          throw new ServiceUnavailableException('O IXC não permitiu pesquisar os campos de telefone');
        }
        const searchedPhone = phoneDigits.length > 11 ? phoneDigits.slice(-11) : phoneDigits;
        candidates = candidates.filter((candidate) => fields.some((field) => {
          const stored = recordText(candidate, field).replace(/\D/g, '');
          const normalizedStored = stored.startsWith('55') && (stored.length === 12 || stored.length === 13)
            ? stored.slice(2)
            : stored.length > 11 ? stored.slice(-11) : stored;
          return normalizedStored === searchedPhone
            || (searchedPhone.length >= 8 && normalizedStored.endsWith(searchedPhone));
        }));
      } else {
        candidates = await listCustomers('razao', term);
      }

      const uniqueCandidates = new Map<string, IxcRecord>();
      for (const candidate of candidates) {
        const document = recordText(candidate, 'cnpj_cpf').replace(/\D/g, '');
        const key = document || `id:${recordText(candidate, 'id')}`;
        if (!uniqueCandidates.has(key)) uniqueCandidates.set(key, candidate);
      }
      const result = await Promise.all([...uniqueCandidates.values()].slice(0, 20).map(async (candidate) => {
        const document = recordText(candidate, 'cnpj_cpf').replace(/\D/g, '');
        return document.length === 11 || document.length === 14
          ? this.searchCustomerByDocument(document)
          : this.searchCustomerByDocument(recordText(candidate, 'id'), [candidate]);
      }));
      const found = result.filter((customer): customer is IxcCustomer => customer !== null);
      if (ambiguousCpfAndPhone) {
        const cpfCustomer = await this.searchCustomerByDocument(digits);
        if (cpfCustomer && !found.some((customer) => customer.id === cpfCustomer.id)) found.unshift(cpfCustomer);
      }
      return found;
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof ServiceUnavailableException) throw error;
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      this.logger.warn(`Falha na busca de assinante do IXC${status ? ` (HTTP ${status})` : ''}`);
      if (status === 401 || status === 403) throw new ServiceUnavailableException('O IXC recusou a credencial configurada');
      throw new ServiceUnavailableException('Não foi possível pesquisar no IXC. Confira a conexão e tente novamente.');
    }
  }

  private isValidCpf(cpf: string): boolean {
    if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
    const digits = [...cpf].map(Number);
    const first = (digits.slice(0, 9).reduce((sum, digit, index) => sum + digit * (10 - index), 0) * 10) % 11 % 10;
    const second = (digits.slice(0, 10).reduce((sum, digit, index) => sum + digit * (11 - index), 0) * 10) % 11 % 10;
    return first === digits[9] && second === digits[10];
  }

  /** Busca manual para o painel; erros de conexão são diferenciados de CPF não encontrado. */
  async searchCustomerByDocument(cpfCnpj: string, matchedRecords?: IxcRecord[]): Promise<IxcCustomer | null> {
    const document = cpfCnpj.replace(/\D/g, '');
    if (!matchedRecords && document.length !== 11 && document.length !== 14) {
      throw new BadRequestException('Informe um CPF ou CNPJ válido');
    }
    // O IXC mantém a pontuação do documento no campo cliente.cnpj_cpf.
    const formattedDocument = matchedRecords ? '' : document.length === 11
      ? `${document.slice(0, 3)}.${document.slice(3, 6)}.${document.slice(6, 9)}-${document.slice(9)}`
      : `${document.slice(0, 2)}.${document.slice(2, 5)}.${document.slice(5, 8)}/${document.slice(8, 12)}-${document.slice(12)}`;

    const config = await this.getConfiguration();
    if (!config.baseUrl || !this.isCredentialConfigured(config.credential)) {
      throw new ServiceUnavailableException('A integração IXC ainda não está configurada');
    }

    try {
      const response = matchedRecords
        ? { data: { registros: matchedRecords } }
        : await this.apiClient(config.baseUrl, config.credential).post('/cliente', {
          qtype: 'cliente.cnpj_cpf', query: formattedDocument, oper: '=', page: '1', rp: '100',
        });
      const clientRecords = Array.isArray(response.data?.registros) ? response.data.registros as IxcRecord[] : [];
      if (!clientRecords.length) return null;
      // O IXC pode ter cadastros separados para o mesmo CPF (por exemplo, matriz e ponto adicional).
      // Mostramos o ativo no resumo e reunimos os acessos de todos os cadastros encontrados.
      clientRecords.sort((a, b) => Number(recordText(b, 'ativo') === 'S') - Number(recordText(a, 'ativo') === 'S'));
      const registro = clientRecords[0];
      const id = recordText(registro, 'id');
      const client = this.apiClient(config.baseUrl, config.credential);
      const list = async (table: string, qtype: string, query: string, rp: number) => {
        const result = await client.post(`/${table}`, { qtype, query, oper: '=', page: '1', rp: String(rp) });
        return Array.isArray(result.data?.registros) ? result.data.registros as IxcRecord[] : [];
      };
      const contractLabel: Record<string, string> = {
        P: 'Pré-contrato', A: 'Ativo', I: 'Inativo', N: 'Negativado', D: 'Desistiu',
      };
      const internetLabel: Record<string, string> = {
        A: 'Ativa', D: 'Desativada', CM: 'Bloqueio manual', CA: 'Bloqueio automático',
        FA: 'Financeiro em atraso', AA: 'Aguardando assinatura',
      };
      const registrations = await Promise.all(clientRecords.map(async (clientRecord) => {
        const clientId = recordText(clientRecord, 'id');
        const [contractsResult, connectionsResult, financeResult] = await Promise.allSettled([
          list('cliente_contrato', 'cliente_contrato.id_cliente', clientId, 100),
          list('radusuarios', 'radusuarios.id_cliente', clientId, 100),
          list('fn_areceber', 'fn_areceber.id_cliente', clientId, 100),
        ]);
        const contracts = contractsResult.status === 'fulfilled' ? contractsResult.value : [];
        const connections = connectionsResult.status === 'fulfilled' ? connectionsResult.value : [];
        const invoices = financeResult.status === 'fulfilled' ? financeResult.value : [];
        const onuLookups = await Promise.all(connections.map(async (connection) => {
          const loginId = recordText(connection, 'id');
          if (!loginId) return { loginId, records: null as IxcRecord[] | null };
          try {
            return {
              loginId,
              records: await list('radpop_radio_cliente_fibra', 'radpop_radio_cliente_fibra.id_login', loginId, 10),
            };
          } catch {
            // Falha na tabela de fibra não impede o painel de mostrar os demais dados do assinante.
            return { loginId, records: null as IxcRecord[] | null };
          }
        }));
        const onuByLoginId = new Map(onuLookups.map((lookup) => [lookup.loginId, lookup.records]));
        const connectionSummary: Array<IxcLogin & { contratoId: string | null }> = connections.map((connection) => {
          const accountActive = recordText(connection, 'ativo');
          const online = recordText(connection, 'online');
          const loginId = recordText(connection, 'id');
          const onuRecords = onuByLoginId.get(loginId);
          // Exponha somente campos operacionais da ONU; a tabela contém também credenciais de gerenciamento.
          const onu = onuRecords?.find((record) => recordText(record, 'sinal_rx') || recordText(record, 'sinal_tx')) ?? onuRecords?.[0];
          return {
            id: loginId,
            login: recordText(connection, 'login'),
            contratoId: recordText(connection, 'id_contrato') || null,
            ativo: accountActive ? (accountActive === 'S' ? 'Sim' : accountActive === 'N' ? 'Não' : accountActive) : null,
            online: online ? (online === 'S' ? 'Sim' : online === 'N' ? 'Não' : online === 'SS' ? 'Sem status' : online) : null,
            onu: {
              consultaDisponivel: onuRecords !== null && onuRecords !== undefined,
              identificada: Boolean(onu || recordText(connection, 'onu_mac')),
              numero: onu ? recordText(onu, 'onu_numero') || null : null,
              tipo: onu ? recordText(onu, 'onu_tipo') || null : null,
              sinalRx: onu ? recordText(onu, 'sinal_rx') || null : null,
              sinalTx: onu ? recordText(onu, 'sinal_tx') || null : null,
              atualizadoEm: onu ? recordText(onu, 'data_sinal') || null : null,
              distancia: onu ? recordText(onu, 'distancia_onu') || null : null,
            },
          };
        });
        const contractGroups = new Map(contracts.map((contract) => {
          const contractId = recordText(contract, 'id');
          const contractStatus = recordText(contract, 'status');
          const internetStatus = recordText(contract, 'status_internet');
          return [contractId, {
            id: contractId,
            situacao: contractStatus ? contractLabel[contractStatus] ?? contractStatus : null,
            situacaoInternet: internetStatus ? internetLabel[internetStatus] ?? internetStatus : null,
            endereco: addressFrom(contract) || null,
            logins: [] as IxcLogin[],
          }];
        }));
        const loginsSemContrato: IxcLogin[] = [];
        for (const connection of connectionSummary) {
          const { contratoId, ...login } = connection;
          // O IXC usa 0 como padrão quando o login não tem vínculo contratual.
          if (!contratoId || contratoId === '0') {
            loginsSemContrato.push(login);
            continue;
          }
          let group = contractGroups.get(contratoId);
          if (!group) {
            group = { id: contratoId, situacao: null, situacaoInternet: null, endereco: null, logins: [] };
            contractGroups.set(contratoId, group);
          }
          group.logins.push(login);
        }
        return {
          cliente: clientRecord,
          contratos: [...contractGroups.values()],
          loginsSemContrato,
          contas: invoices,
          financeiroDisponivel: financeResult.status === 'fulfilled',
        };
      }));
      const invoices = registrations.flatMap((item) => item.contas);
      const allContracts = registrations.flatMap((item) => item.contratos.map((contract) => ({
        ...contract,
        clientId: recordText(item.cliente, 'id'),
      })));
      const addresses = [...new Set(registrations.flatMap((item) => [
        addressFrom(item.cliente),
        ...item.contratos.map((contract) => contract.endereco ?? ''),
      ]).filter(Boolean))];
      const openInvoices = invoices.filter((invoice) => ['A', 'P'].includes(recordText(invoice, 'status'))
        && moneyValue(invoice.valor_aberto ?? invoice.valor) > 0);
      const now = new Date();
      const overdueInvoices = openInvoices.filter((invoice) => {
        const due = recordText(invoice, 'data_vencimento');
        const parsedDue = due ? new Date(`${due.slice(0, 10)}T23:59:59`) : null;
        return parsedDue && !Number.isNaN(parsedDue.getTime()) && parsedDue < now;
      });
      const sumOpen = (items: IxcRecord[]) => Number(items.reduce((sum, invoice) => sum + moneyValue(invoice.valor_aberto ?? invoice.valor), 0).toFixed(2));
      const financialAvailable = registrations.every((item) => item.financeiroDisponivel);
      const overdueInvoiceDetails = financialAvailable ? overdueInvoices.map((invoice) => {
        const rawPaymentLink = recordText(invoice, 'link_gateway') || recordText(invoice, 'gateway_link');
        let safePaymentLink: string | null = null;
        try {
          const parsed = rawPaymentLink ? new URL(rawPaymentLink) : null;
          if (parsed && (parsed.protocol === 'https:' || parsed.protocol === 'http:')) safePaymentLink = parsed.toString();
        } catch { /* Link ausente ou inválido: entregar a linha digitável, se disponível. */ }
        return {
          id: recordText(invoice, 'id'),
          dataVencimento: recordText(invoice, 'data_vencimento'),
          valorEmAberto: moneyValue(invoice.valor_aberto ?? invoice.valor),
          linhaDigitavel: recordText(invoice, 'linha_digitavel') || null,
          linkPagamento: safePaymentLink,
        };
      }) : null;
      const activeContract = allContracts.find((item) => item.situacao === 'Ativo') ?? allContracts[0];
      return {
        id,
        razaoSocial: recordText(registro, 'razao'),
        cpfCnpj: recordText(registro, 'cnpj_cpf') || (matchedRecords ? '' : document),
        situacaoContrato: activeContract?.situacao
          ?? (recordText(registro, 'ativo') === 'S' ? 'Ativo' : recordText(registro, 'ativo') === 'N' ? 'Inativo' : recordText(registro, 'ativo')),
        login: recordText(registro, 'login') || registrations.flatMap((item) => [
          ...item.contratos.flatMap((contract) => contract.logins),
          ...item.loginsSemContrato,
        ]).find((item) => item.login)?.login || undefined,
        enderecos: addresses,
        cadastrosIxc: registrations.map((item) => ({
          id: recordText(item.cliente, 'id'),
          nome: recordText(item.cliente, 'razao') || 'Nome não informado',
          situacao: recordText(item.cliente, 'ativo') === 'S' ? 'Ativo' : recordText(item.cliente, 'ativo') === 'N' ? 'Inativo' : null,
          contratos: item.contratos,
          loginsSemContrato: item.loginsSemContrato,
        })),
        financeiro: {
          disponivel: financialAvailable,
          contasEmAberto: financialAvailable ? openInvoices.length : null,
          contasVencidas: financialAvailable ? overdueInvoices.length : null,
          valorEmAberto: financialAvailable ? sumOpen(openInvoices) : null,
          valorVencido: financialAvailable ? sumOpen(overdueInvoices) : null,
          boletosVencidos: overdueInvoiceDetails,
        },
        consultadoEm: new Date().toISOString(),
      };
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      this.logger.warn(`Falha na busca manual do IXC${status ? ` (HTTP ${status})` : ''}`);
      if (status === 401 || status === 403) {
        throw new ServiceUnavailableException('O IXC recusou a credencial configurada');
      }
      throw new ServiceUnavailableException('Não foi possível consultar o IXC. Confira a conexão e tente novamente.');
    }
  }

  /** Localiza os dados operacionais do assinante pelo ID IXC associado ao chamado. */
  async getCustomerByIxcId(ixcCustomerId: string): Promise<IxcCustomer> {
    const config = await this.getConfiguration();
    if (!config.baseUrl || !this.isCredentialConfigured(config.credential)) {
      throw new ServiceUnavailableException('A integração IXC ainda não está configurada');
    }
    try {
      const response = await this.apiClient(config.baseUrl, config.credential).post('/cliente', {
        qtype: 'cliente.id', query: ixcCustomerId, oper: '=', page: '1', rp: '10',
      });
      const records = Array.isArray(response.data?.registros) ? response.data.registros as IxcRecord[] : [];
      const record = records.find((item) => recordText(item, 'id') === ixcCustomerId);
      if (!record) throw new NotFoundException('Cadastro IXC vinculado ao chamado não foi encontrado');
      const document = recordText(record, 'cnpj_cpf');
      const customer = document
        ? await this.searchCustomerByDocument(document)
        : await this.searchCustomerByDocument('', [record]);
      if (!customer) throw new NotFoundException('Cadastro IXC vinculado ao chamado não foi encontrado');
      return customer;
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ServiceUnavailableException) throw error;
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      this.logger.warn(`Falha ao consultar diagnóstico no IXC${status ? ` (HTTP ${status})` : ''}`);
      if (status === 401 || status === 403) throw new ServiceUnavailableException('O IXC recusou a credencial configurada');
      throw new ServiceUnavailableException('Não foi possível consultar os dados de conexão no IXC.');
    }
  }
}
