/**
 * Dados mínimos do cliente retornados pela API do IXC Soft,
 * usados para vincular o usuário do app ao cadastro/contrato real.
 */
export interface IxcCustomer {
  id: string;
  razaoSocial: string;
  cpfCnpj: string;
  situacaoContrato: string;
  login?: string;
  enderecos: string[];
  cadastrosIxc: Array<{
    id: string;
    nome: string;
    situacao: string | null;
    contratos: Array<{
      id: string;
      situacao: string | null;
      situacaoInternet: string | null;
      endereco: string | null;
      logins: IxcLogin[];
    }>;
    loginsSemContrato: IxcLogin[];
  }>;
  financeiro: {
    disponivel: boolean;
    contasEmAberto: number | null;
    contasVencidas: number | null;
    valorEmAberto: number | null;
    valorVencido: number | null;
    boletosVencidos?: IxcOverdueInvoice[] | null;
  };
  consultadoEm: string;
}

export interface IxcOverdueInvoice {
  id: string;
  dataVencimento: string;
  valorEmAberto: number;
  linhaDigitavel: string | null;
  linkPagamento: string | null;
}

export interface IxcLogin {
  id: string;
  login: string;
  ativo: string | null;
  online: string | null;
  onu: {
    consultaDisponivel: boolean;
    identificada: boolean;
    numero: string | null;
    tipo: string | null;
    sinalRx: string | null;
    sinalTx: string | null;
    atualizadoEm: string | null;
    distancia: string | null;
  };
}
