import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { IxcController } from './ixc.controller';
import { IxcService } from './ixc.service';

@Module({
  imports: [AuthModule],
  controllers: [IxcController],
  providers: [IxcService],
  exports: [IxcService],
})
export class IxcModule {}
