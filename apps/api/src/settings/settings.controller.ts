import { Body, Controller, Get, Patch, Post, Param, UseGuards } from '@nestjs/common';
import { UserRole } from '@canal-direto/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CreateChannelDto } from './dto/create-channel.dto';
import { UpdateChannelDto } from './dto/update-channel.dto';
import { UpdateGeneralSettingsDto } from './dto/update-general-settings.dto';
import { UpdateSecuritySettingsDto } from './dto/update-security-settings.dto';
import { UpdateDiagnosticFlowDto } from './dto/update-diagnostic-flow.dto';
import { SettingsService } from './settings.service';

@Controller('settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.AGENT, UserRole.TECHNICIAN, UserRole.ADMIN)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  getSettings() { return this.settingsService.getSettings(); }

  @Get('diagnostic-flow')
  getDiagnosticFlow() { return this.settingsService.getDiagnosticFlow(); }

  @Patch('diagnostic-flow')
  @Roles(UserRole.ADMIN)
  updateDiagnosticFlow(@Body() dto: UpdateDiagnosticFlowDto) { return this.settingsService.updateDiagnosticFlow(dto); }

  @Get('communication-flows')
  getCommunicationFlows() { return this.settingsService.getCommunicationFlows(); }

  @Patch('communication-flows')
  @Roles(UserRole.ADMIN)
  updateCommunicationFlows(@Body() body: { flows: unknown[] }) { return this.settingsService.updateCommunicationFlows(body); }

  @Patch('channel-flow-assignments')
  @Roles(UserRole.ADMIN)
  updateChannelFlowAssignments(@Body() body: { assignments: Record<string, string | null> }) {
    return this.settingsService.updateChannelFlowAssignments(body);
  }

  @Patch('general')
  @Roles(UserRole.ADMIN)
  updateGeneral(@Body() dto: UpdateGeneralSettingsDto) { return this.settingsService.updateGeneral(dto); }

  @Patch('security')
  @Roles(UserRole.ADMIN)
  updateSecurity(@Body() dto: UpdateSecuritySettingsDto) { return this.settingsService.updateSecurity(dto); }

  @Post('channels')
  @Roles(UserRole.ADMIN)
  createChannel(@Body() dto: CreateChannelDto) { return this.settingsService.createChannel(dto); }

  @Patch('channels/:id')
  @Roles(UserRole.ADMIN)
  updateChannel(@Param('id') id: string, @Body() dto: UpdateChannelDto) {
    return this.settingsService.updateChannel(id, dto);
  }
}
