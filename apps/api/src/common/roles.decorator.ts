import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@canal-direto/shared';

export const ROLES_KEY = 'roles';

/**
 * Decorator para restringir uma rota a um ou mais papéis de usuário.
 * Uso: @Roles(UserRole.AGENT, UserRole.ADMIN)
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
