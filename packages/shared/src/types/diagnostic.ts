import { TicketDepartment } from './ticket';
import { IxcOverdueInvoice } from './ixc';

export type DiagnosticStatus = 'OK' | 'WARNING' | 'CRITICAL' | 'UNAVAILABLE';

export interface DiagnosticCheck {
  status: DiagnosticStatus;
  summary: string;
  details: string[];
}

export interface ConnectionDiagnostic {
  customerName: string;
  checkedAt: string;
  recommendation: 'N1' | 'N2' | 'FINANCE' | 'FIELD' | 'POSSIBLE_INCIDENT';
  recommendationText: string;
  routeDepartment: TicketDepartment;
  matchedRule: string | null;
  billing: DiagnosticCheck & { overdueInvoices?: IxcOverdueInvoice[] | null };
  pppoe: DiagnosticCheck;
  optical: DiagnosticCheck;
  incident: DiagnosticCheck;
}

export type DiagnosticFlowField = 'POSSIBLE_INCIDENT' | 'OVERDUE_INVOICES' | 'ALL_ACTIVE_OFFLINE' | 'RX_DBM' | 'ANY_PPPOE_ONLINE';
export type DiagnosticFlowOperator = 'IS_TRUE' | 'IS_FALSE' | 'GT' | 'GTE' | 'LT' | 'LTE';

export interface DiagnosticFlowRule {
  id: string;
  name: string;
  enabled: boolean;
  field: DiagnosticFlowField;
  operator: DiagnosticFlowOperator;
  threshold: number | null;
  department: TicketDepartment;
  message: string;
}

export const DEFAULT_DIAGNOSTIC_FLOW: DiagnosticFlowRule[] = [
  { id: 'possible-incident', name: 'Possível incidente coletivo', enabled: true, field: 'POSSIBLE_INCIDENT', operator: 'IS_TRUE', threshold: null, department: TicketDepartment.SUPPORT_N2, message: 'Verifique se há incidente coletivo na região antes de encaminhar um técnico.' },
  { id: 'overdue-billing', name: 'Conta vencida', enabled: true, field: 'OVERDUE_INVOICES', operator: 'GT', threshold: 0, department: TicketDepartment.FINANCE, message: 'Confira o financeiro e possíveis bloqueios antes de solicitar visita técnica.' },
  { id: 'critical-optical', name: 'Potência óptica crítica', enabled: true, field: 'RX_DBM', operator: 'LT', threshold: -30, department: TicketDepartment.FIELD, message: 'A leitura óptica indica sinal crítico; valide a conexão física e encaminhe para Campo.' },
  { id: 'weak-optical', name: 'Potência óptica baixa', enabled: true, field: 'RX_DBM', operator: 'LT', threshold: -27, department: TicketDepartment.SUPPORT_N2, message: 'A potência óptica requer atenção. Suporte N2 deve validar antes de solicitar visita.' },
  { id: 'pppoe-offline', name: 'Todos os logins offline', enabled: true, field: 'ALL_ACTIVE_OFFLINE', operator: 'IS_TRUE', threshold: null, department: TicketDepartment.SUPPORT_N2, message: 'Suporte N2 deve validar sessão PPPoE, autenticação e concentrador antes de visita.' },
  { id: 'pppoe-online', name: 'Login PPPoE online', enabled: true, field: 'ANY_PPPOE_ONLINE', operator: 'IS_TRUE', threshold: null, department: TicketDepartment.SUPPORT_N1, message: 'Há login PPPoE online. Oriente testes de roteador, Wi-Fi e dispositivo antes de escalar.' },
];
