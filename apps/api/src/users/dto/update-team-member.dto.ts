import { IsBoolean, IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const SUPPORT_ROLES = ['ADMIN', 'AGENT', 'TECHNICIAN'];

export class UpdateTeamMemberDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) name?: string;
  @IsOptional() @IsEmail() @MaxLength(200) email?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsIn(SUPPORT_ROLES) role?: 'ADMIN' | 'AGENT' | 'TECHNICIAN';
  @IsOptional() @IsString() @MinLength(6) password?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
