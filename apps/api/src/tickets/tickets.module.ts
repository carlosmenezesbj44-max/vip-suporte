import { Module } from '@nestjs/common';
import { TicketsService } from './tickets.service';
import { PortalTicketsController, TicketsController } from './tickets.controller';
import { TicketsGateway } from './tickets.gateway';
import { IxcModule } from '../ixc/ixc.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [IxcModule, AuthModule],
  providers: [TicketsService, TicketsGateway],
  controllers: [TicketsController, PortalTicketsController],
})
export class TicketsModule {}
