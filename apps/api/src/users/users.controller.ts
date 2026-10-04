import { Body, Controller, Get, Post, Patch, Param, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { UserRole } from '@canal-direto/shared';
import { CreateTeamMemberDto } from './dto/create-team-member.dto';
import { UpdateTeamMemberDto } from './dto/update-team-member.dto';
import { UpdateAgentProfileDto } from './dto/update-agent-profile.dto';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /** Cadastro público (ex: cliente criando sua conta no app). */
  @Post()
  async create(@Body() dto: CreateUserDto) {
    const user = await this.usersService.create(dto);
    const { passwordHash, ...safeUser } = user;
    return safeUser;
  }

  /** Lista de usuários, restrita a atendentes/admin. */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.AGENT, UserRole.TECHNICIAN, UserRole.ADMIN)
  @Get()
  async list() {
    return this.usersService.list();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.AGENT, UserRole.TECHNICIAN, UserRole.ADMIN)
  @Patch('me/profile')
  updateAgentProfile(@Req() request: Request & { user: { id: string } }, @Body() dto: UpdateAgentProfileDto) {
    return this.usersService.updateAgentProfile(request.user.id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post('team')
  async createTeamMember(@Body() dto: CreateTeamMemberDto) {
    return this.usersService.createTeamMember(dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch('team/:id')
  async updateTeamMember(@Param('id') id: string, @Body() dto: UpdateTeamMemberDto, @Req() request: Request & { user: { id: string } }) {
    return this.usersService.updateTeamMember(id, dto, request.user.id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.AGENT, UserRole.TECHNICIAN, UserRole.ADMIN)
  @Get('customers')
  async searchCustomers(@Query('search') search?: string) {
    return this.usersService.searchCustomers(search);
  }
}
