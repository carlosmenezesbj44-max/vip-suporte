/**
 * Status possíveis de um chamado (ticket).
 */
export enum TicketStatus {
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  WAITING_CUSTOMER = 'WAITING_CUSTOMER',
  RESOLVED = 'RESOLVED',
  CLOSED = 'CLOSED',
}

export enum TicketPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  URGENT = 'URGENT',
}

export enum TicketChannel {
  PORTAL = 'PORTAL',
  WHATSAPP = 'WHATSAPP',
  PHONE = 'PHONE',
  EMAIL = 'EMAIL',
  OTHER = 'OTHER',
}

export enum TicketDepartment {
  COMMERCIAL = 'COMMERCIAL',
  FINANCE = 'FINANCE',
  SUPPORT_N1 = 'SUPPORT_N1',
  SUPPORT_N2 = 'SUPPORT_N2',
  FIELD = 'FIELD',
}

export const ticketDepartmentOrder = [
  TicketDepartment.COMMERCIAL,
  TicketDepartment.FINANCE,
  TicketDepartment.SUPPORT_N1,
  TicketDepartment.SUPPORT_N2,
  TicketDepartment.FIELD,
] as const;

/**
 * Categorias comuns de chamados em um provedor de internet.
 */
export enum TicketCategory {
  CONNECTION_DOWN = 'CONNECTION_DOWN',
  SLOW_CONNECTION = 'SLOW_CONNECTION',
  BILLING = 'BILLING',
  EQUIPMENT = 'EQUIPMENT',
  CONTRACT = 'CONTRACT',
  OTHER = 'OTHER',
}

export interface TicketMessage {
  id: string;
  ticketId: string;
  authorId: string;
  authorName: string;
  message: string;
  attachments?: TicketAttachment[];
  createdAt: string;
}

export interface TicketAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

export interface Ticket {
  id: string;
  protocol: string;
  title: string;
  description: string;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  channel?: TicketChannel;
  department: TicketDepartment;
  customerId: string;
  assignedToId?: string | null;
  /** ID do cliente/contrato correspondente no IXC. */
  ixcCustomerId?: string | null;
  satisfactionRating?: number | null;
  satisfactionComment?: string | null;
  satisfactionSubmittedAt?: string | null;
  messages?: TicketMessage[];
  createdAt: string;
  updatedAt: string;
  transfers?: TicketTransfer[];
}

export interface TicketTransfer {
  id: string;
  ticketId: string;
  fromDepartment: TicketDepartment;
  toDepartment: TicketDepartment;
  transferredById: string;
  transferredBy?: { id: string; name: string };
  transferredToId?: string | null;
  transferredTo?: { id: string; name: string } | null;
  note?: string | null;
  createdAt: string;
}

export interface CreateTicketInput {
  title: string;
  description: string;
  category: TicketCategory;
}
