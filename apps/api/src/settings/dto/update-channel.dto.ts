import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

const CHANNEL_TYPES = ['WHATSAPP', 'PHONE', 'EMAIL', 'OTHER'];

export class UpdateChannelDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(80) name?: string;
  @IsOptional() @IsIn(CHANNEL_TYPES) type?: 'WHATSAPP' | 'PHONE' | 'EMAIL' | 'OTHER';
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200) address?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
}
