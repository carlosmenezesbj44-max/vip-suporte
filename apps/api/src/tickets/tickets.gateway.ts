import { Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AuthenticatedUser, Ticket } from '@canal-direto/shared';
import { TicketsService } from './tickets.service';

interface AuthenticatedSocket extends Socket {
  data: { user: AuthenticatedUser };
}

/**
 * Gateway WebSocket (Socket.IO) para chat em tempo real dentro de um chamado.
 * Cada chamado é uma "sala" (`ticket:<id>`); clientes entram na sala ao abrir
 * a tela do chamado e recebem novas mensagens e mudanças de status ao vivo.
 */
@WebSocketGateway({ cors: { origin: '*' }, namespace: '/tickets' })
export class TicketsGateway implements OnGatewayConnection {
  private readonly logger = new Logger(TicketsGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly ticketsService: TicketsService,
  ) {}

  /** Autentica o socket via JWT enviado em `handshake.auth.token`. */
  async handleConnection(client: AuthenticatedSocket) {
    try {
      const token = client.handshake.auth?.token || client.handshake.query?.token;
      if (!token) {
        throw new UnauthorizedException('Token ausente');
      }
      const payload = this.jwtService.verify(String(token));
      client.data.user = {
        id: payload.sub,
        email: payload.email,
        role: payload.role,
        name: '',
        portalTicketId: payload.portalTicketId,
      };
      await client.join(`user:${payload.sub}`);
      if (['ADMIN', 'AGENT', 'TECHNICIAN'].includes(payload.role)) await client.join('support:agents');
    } catch (error) {
      this.logger.warn(`Conexão WebSocket rejeitada: ${(error as Error).message}`);
      client.disconnect();
    }
  }

  @SubscribeMessage('joinTicket')
  async handleJoinTicket(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() ticketId: string) {
    // Reaproveita a verificação de permissão do service (lança erro se o
    // usuário não tiver acesso ao chamado).
    await this.ticketsService.findOne(client.data.user, ticketId);
    client.join(`ticket:${ticketId}`);
  }

  @SubscribeMessage('sendMessage')
  async handleSendMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: { ticketId: string; message: string },
  ) {
    const { message, updatedTicket, flowMessages } = await this.ticketsService.addMessage(client.data.user, payload.ticketId, payload.message);
    this.server.to(`ticket:${payload.ticketId}`).emit('newMessage', message);
    flowMessages.forEach((flowMessage) => this.server.to(`ticket:${payload.ticketId}`).emit('newMessage', flowMessage));
    if (updatedTicket) this.emitTicketUpdated(updatedTicket as any);
    return message;
  }

  /** Usado pelo controller REST para avisar a sala quando o ticket é atualizado (status/prioridade/responsável). */
  emitTicketUpdated(ticket: Ticket) {
    // Histórico e observações de transferência são internos e não devem ser
    // enviados aos sockets de clientes que participam da conversa.
    const { transfers: _internalTransfers, ...publicTicketUpdate } = ticket as Ticket & { transfers?: unknown };
    this.server.to(`ticket:${ticket.id}`).emit('ticketUpdated', publicTicketUpdate);
  }

  /** Notifica os atendentes sobre chamados novos, inclusive quando ainda não entraram em uma sala. */
  emitTicketCreated(ticket: unknown) {
    this.server.to('support:agents').emit('ticketCreated', ticket);
  }
}
