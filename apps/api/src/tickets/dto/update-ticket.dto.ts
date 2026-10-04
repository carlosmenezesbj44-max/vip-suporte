import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { TicketDepartment, TicketPriority, TicketStatus } from '@canal-direto/shared';

export class UpdateTicketDto {
  @IsOptional()
  @IsEnum(TicketStatus)
  status?: TicketStatus;

  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;

  @IsOptional()
  @IsUUID()
  assignedToId?: string | null;

  @IsOptional()
  @IsEnum(TicketDepartment)
  department?: TicketDepartment;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  transferNote?: string;
}
