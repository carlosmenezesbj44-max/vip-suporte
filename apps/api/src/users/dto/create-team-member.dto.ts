import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const SUPPORT_ROLES = ['ADMIN', 'AGENT', 'TECHNICIAN'];

export class CreateTeamMemberDto {
  @IsString() @IsNotEmpty() @MaxLength(120) name: string;
  @IsEmail() @MaxLength(200) email: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsIn(SUPPORT_ROLES) role: 'ADMIN' | 'AGENT' | 'TECHNICIAN';
  @IsString() @MinLength(6) password: string;
}
