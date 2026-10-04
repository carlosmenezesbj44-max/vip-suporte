/**
 * Papéis de usuário no sistema.
 */
export enum UserRole {
  CUSTOMER = 'CUSTOMER',
  AGENT = 'AGENT',
  TECHNICIAN = 'TECHNICIAN',
  ADMIN = 'ADMIN',
}

export enum AgentAvailability {
  AVAILABLE = 'AVAILABLE',
  AWAY = 'AWAY',
  UNAVAILABLE = 'UNAVAILABLE',
}

export interface User {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  role: UserRole;
  /** ID do cliente no IXC, quando o usuário for CUSTOMER vinculado. */
  ixcCustomerId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  availability?: AgentAvailability;
  avatarData?: string | null;
  /** Restringe um acesso temporário do portal a um único chamado. */
  portalTicketId?: string;
}
