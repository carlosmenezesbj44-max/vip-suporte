import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Req, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TicketsService } from './tickets.service';
import { TicketsGateway } from './tickets.gateway';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { CreateMessageDto } from './dto/create-message.dto';
import { SubmitSatisfactionDto } from './dto/submit-satisfaction.dto';
import { JwtService } from '@nestjs/jwt';
import { diskStorage } from 'multer';
import { createReadStream, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

const attachmentDirectory = process.env.UPLOAD_DIR || join(__dirname, '../../uploads');
const acceptedMimeTypes = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'application/pdf', 'text/plain', 'application/zip',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.android.package-archive',
]);

@UseGuards(JwtAuthGuard)
@Controller('tickets')
export class TicketsController {
  constructor(
    private readonly ticketsService: TicketsService,
    private readonly ticketsGateway: TicketsGateway,
  ) {}

  @Post()
  async create(@Req() req: any, @Body() dto: CreateTicketDto) {
    const ticket = await this.ticketsService.create(req.user, dto);
    this.ticketsGateway.emitTicketCreated(ticket);
    return ticket;
  }

  @Get()
  list(@Req() req: any) {
    return this.ticketsService.list(req.user);
  }

  @Get(':id')
  async findOne(@Req() req: any, @Param('id') id: string) {
    const flowMessages = await this.ticketsService.ensurePortalFlowStarted(req.user, id);
    flowMessages.forEach((message) => this.ticketsGateway.server.to(`ticket:${id}`).emit('newMessage', message));
    return this.ticketsService.findOne(req.user, id);
  }

  @Post(':id/diagnostic')
  diagnoseConnection(@Req() req: any, @Param('id') id: string) {
    return this.ticketsService.diagnoseConnection(req.user, id);
  }

  @Patch(':id')
  async update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateTicketDto) {
    const { closureMessage, ...ticket } = await this.ticketsService.update(req.user, id, dto);
    this.ticketsGateway.emitTicketUpdated(ticket as any);
    if (closureMessage) this.ticketsGateway.server.to(`ticket:${id}`).emit('newMessage', closureMessage);
    return ticket;
  }

  @Post(':id/satisfaction')
  submitSatisfaction(@Req() req: any, @Param('id') id: string, @Body() dto: SubmitSatisfactionDto) {
    return this.ticketsService.submitSatisfaction(req.user, id, dto);
  }

  @Post(':id/messages')
  async addMessage(@Req() req: any, @Param('id') id: string, @Body() dto: CreateMessageDto) {
    const { message, updatedTicket, flowMessages } = await this.ticketsService.addMessage(req.user, id, dto.message);
    this.ticketsGateway.server.to(`ticket:${id}`).emit('newMessage', message);
    flowMessages.forEach((flowMessage) => this.ticketsGateway.server.to(`ticket:${id}`).emit('newMessage', flowMessage));
    if (updatedTicket) this.ticketsGateway.emitTicketUpdated(updatedTicket as any);
    return message;
  }

  @Post(':id/attachments')
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      destination: (_request, _file, callback) => {
        try { mkdirSync(attachmentDirectory, { recursive: true }); callback(null, attachmentDirectory); }
        catch (error) { callback(error as Error, attachmentDirectory); }
      },
      filename: (_request, _file, callback) => callback(null, randomUUID()),
    }),
    limits: { fileSize: 100 * 1024 * 1024 },
    fileFilter: (_request, file, callback) => {
      if (acceptedMimeTypes.has(file.mimetype)) callback(null, true);
      else callback(new BadRequestException('Formato não permitido. Envie fotos, PDF, documentos ou APK.'), false);
    },
  }))
  async addAttachment(
    @Req() req: any,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('message') messageText = '',
  ) {
    if (!file) throw new BadRequestException('Selecione um arquivo para enviar');
    try {
      const message = await this.ticketsService.addAttachment(req.user, id, file, messageText);
      this.ticketsGateway.server.to(`ticket:${id}`).emit('newMessage', message);
      return message;
    } catch (error) {
      try { unlinkSync(file.path); } catch { /* arquivo já removido */ }
      throw error;
    }
  }

  @Get(':id/attachments/:attachmentId')
  async downloadAttachment(@Req() req: any, @Param('id') id: string, @Param('attachmentId') attachmentId: string) {
    const attachment = await this.ticketsService.getAttachment(req.user, id, attachmentId);
    const filename = encodeURIComponent(attachment.name);
    return new StreamableFile(createReadStream(join(attachmentDirectory, attachment.storageName)), {
      type: attachment.mimeType,
      disposition: `attachment; filename*=UTF-8''${filename}`,
    });
  }
}

/** Entrada pública do app para o cliente confirmar o cadastro IXC e abrir chamado sem senha. */
@Controller('portal/tickets')
export class PortalTicketsController {
  constructor(
    private readonly ticketsService: TicketsService,
    private readonly jwtService: JwtService,
    private readonly ticketsGateway: TicketsGateway,
  ) {}

  @Post()
  async create(@Body() dto: CreateTicketDto) {
    const result = await this.ticketsService.createFromPortal(dto);
    const accessToken = await this.jwtService.signAsync({
      sub: result.sessionCustomer.id,
      email: result.sessionCustomer.email,
      role: result.sessionCustomer.role,
      portalTicketId: result.ticket.id,
    }, { expiresIn: '12h' });
    if (!result.reused) this.ticketsGateway.emitTicketCreated(result.ticket);
    return {
      id: result.ticket.id,
      protocol: result.ticket.protocol,
      status: result.ticket.status,
      reused: result.reused,
      accessToken,
    };
  }
}
