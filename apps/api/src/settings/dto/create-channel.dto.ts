import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

const CHANNEL_TYPES = ['WHATSAPP', 'PHONE', 'EMAIL', 'OTHER'];

export class CreateChannelDto {
  @IsString() @IsNotEmpty() @MaxLength(80) name: string;
  @IsIn(CHANNEL_TYPES) type: 'WHATSAPP' | 'PHONE' | 'EMAIL' | 'OTHER';
  @IsString() @IsNotEmpty() @MaxLength(200) address: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
}
