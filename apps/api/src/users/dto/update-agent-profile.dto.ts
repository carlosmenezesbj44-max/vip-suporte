import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { AgentAvailability } from '@canal-direto/shared';

export class UpdateAgentProfileDto {
  @IsOptional()
  @IsEnum(AgentAvailability)
  availability?: AgentAvailability;

  @IsOptional()
  @IsString()
  @MaxLength(200000)
  avatarData?: string | null;
}
