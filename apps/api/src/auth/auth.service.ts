import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { AgentAvailability as SharedAvailability, AuthenticatedUser } from '@canal-direto/shared';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly settingsService: SettingsService,
  ) {}

  async validateUser(email: string, password: string): Promise<AuthenticatedUser> {
    const user = await this.usersService.findByEmail(email);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Credenciais inválidas');
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Credenciais inválidas');
    }

    return { id: user.id, name: user.name, email: user.email, role: user.role as any, availability: user.availability as SharedAvailability, avatarData: user.avatarData };
  }

  async login(email: string, password: string) {
    const user = await this.validateUser(email, password);
    const payload = { sub: user.id, email: user.email, role: user.role };
    const { sessionDurationDays } = await this.settingsService.getSecurity();
    return {
      accessToken: this.jwtService.sign(payload, { expiresIn: `${sessionDurationDays}d` as `${number}d` }),
      user,
    };
  }
}
