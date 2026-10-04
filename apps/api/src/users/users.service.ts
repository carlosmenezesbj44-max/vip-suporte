import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UserRole } from '@canal-direto/shared';
import { SettingsService } from '../settings/settings.service';
import { CreateTeamMemberDto } from './dto/create-team-member.dto';
import { UpdateTeamMemberDto } from './dto/update-team-member.dto';
import { UpdateAgentProfileDto } from './dto/update-agent-profile.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService, private readonly settingsService: SettingsService) {}

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async create(dto: CreateUserDto) {
    const { passwordMinLength } = await this.settingsService.getSecurity();
    if (dto.password.length < passwordMinLength) {
      throw new BadRequestException(`A senha deve ter pelo menos ${passwordMinLength} caracteres`);
    }
    const passwordHash = await bcrypt.hash(dto.password, 10);
    return this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email,
        phone: dto.phone.replace(/\D/g, ''),
        passwordHash,
        role: UserRole.CUSTOMER,
      },
    });
  }

  async list() {
    return this.prisma.user.findMany({
      where: { role: { in: [UserRole.AGENT, UserRole.TECHNICIAN, UserRole.ADMIN] } },
      select: { id: true, name: true, email: true, phone: true, role: true, isActive: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateAgentProfile(id: string, dto: UpdateAgentProfileDto) {
    const current = await this.prisma.user.findUnique({ where: { id }, select: { role: true } });
    if (!current || current.role === UserRole.CUSTOMER) throw new NotFoundException('Conta de atendente não encontrada');

    const data: { availability?: any; avatarData?: string | null } = {};
    if (dto.availability !== undefined) data.availability = dto.availability;
    if (dto.avatarData !== undefined) {
      if (dto.avatarData !== null && !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(dto.avatarData)) {
        throw new BadRequestException('A foto precisa ser uma imagem JPEG, PNG ou WebP válida');
      }
      data.avatarData = dto.avatarData;
    }

    return this.prisma.user.update({
      where: { id },
      data,
      select: { id: true, name: true, email: true, role: true, availability: true, avatarData: true },
    });
  }

  async createTeamMember(dto: CreateTeamMemberDto) {
    const email = dto.email.trim().toLowerCase();
    if (await this.findByEmail(email)) throw new ConflictException('Este e-mail já está cadastrado');
    const { passwordMinLength } = await this.settingsService.getSecurity();
    if (dto.password.length < passwordMinLength) {
      throw new BadRequestException(`A senha deve ter pelo menos ${passwordMinLength} caracteres`);
    }
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: { name: dto.name.trim(), email, phone: dto.phone?.replace(/\D/g, '') || null, role: dto.role, passwordHash },
      select: { id: true, name: true, email: true, phone: true, role: true, isActive: true, createdAt: true },
    });
    return user;
  }

  async updateTeamMember(id: string, dto: UpdateTeamMemberDto, actorId: string) {
    const current = await this.prisma.user.findUnique({ where: { id } });
    if (!current || current.role === UserRole.CUSTOMER) throw new NotFoundException('Membro da equipe não encontrado');

    const nextRole = dto.role ?? current.role;
    const nextActive = dto.isActive ?? current.isActive;
    if (id === actorId && (!nextActive || nextRole !== UserRole.ADMIN)) {
      throw new BadRequestException('Você não pode desativar ou remover seu próprio acesso de administrador');
    }
    if (current.role === UserRole.ADMIN && (nextRole !== UserRole.ADMIN || !nextActive)) {
      const admins = await this.prisma.user.count({ where: { role: UserRole.ADMIN, isActive: true } });
      if (admins <= 1) throw new BadRequestException('O último administrador ativo não pode ser removido ou desativado');
    }

    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.email !== undefined) {
      const email = dto.email.trim().toLowerCase();
      const conflict = await this.prisma.user.findFirst({ where: { email, NOT: { id } }, select: { id: true } });
      if (conflict) throw new ConflictException('Este e-mail já está cadastrado');
      data.email = email;
    }
    if (dto.phone !== undefined) data.phone = dto.phone.replace(/\D/g, '') || null;
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.password !== undefined) {
      const { passwordMinLength } = await this.settingsService.getSecurity();
      if (dto.password.length < passwordMinLength) {
        throw new BadRequestException(`A senha deve ter pelo menos ${passwordMinLength} caracteres`);
      }
      data.passwordHash = await bcrypt.hash(dto.password, 10);
    }

    return this.prisma.user.update({
      where: { id }, data,
      select: { id: true, name: true, email: true, phone: true, role: true, isActive: true, createdAt: true },
    });
  }

  async searchCustomers(search?: string) {
    const term = search?.trim();
    const phoneDigits = term?.replace(/\D/g, '');
    return this.prisma.user.findMany({
      where: {
        role: UserRole.CUSTOMER,
        ...(term
          ? {
              OR: [
                { name: { contains: term, mode: 'insensitive' } },
                ...(phoneDigits ? [{ phone: { contains: phoneDigits } }] : []),
              ],
            }
          : {}),
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        createdAt: true,
        ticketsCreated: {
          select: { id: true, protocol: true, title: true, status: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 3,
        },
        _count: { select: { ticketsCreated: true } },
      },
      orderBy: { name: 'asc' },
      take: 100,
    });
  }
}
