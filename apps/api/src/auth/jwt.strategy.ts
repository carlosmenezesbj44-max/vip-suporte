import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { AgentAvailability as SharedAvailability, AuthenticatedUser } from '@canal-direto/shared';
import { PrismaService } from '../prisma/prisma.service';
import { UnauthorizedException } from '@nestjs/common';

interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  portalTicketId?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService, private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET') ?? 'dev-secret',
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive) throw new UnauthorizedException('Sessão inválida');
    return {
      id: user.id,
      email: user.email,
      role: user.role as any,
      name: user.name,
      availability: user.availability as SharedAvailability,
      avatarData: user.avatarData,
      portalTicketId: payload.portalTicketId,
    };
  }
}
