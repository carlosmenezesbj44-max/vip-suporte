import { IsEmail, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

export class UpdateGeneralSettingsDto {
  @IsOptional() @IsString() @MaxLength(120) companyName?: string;
  @ValidateIf((_object, value) => typeof value === 'string' && value.length > 0) @IsEmail() @MaxLength(200) supportEmail?: string;
  @IsOptional() @IsString() @MaxLength(40) supportPhone?: string;
  @IsOptional() @IsString() @MaxLength(80) timezone?: string;
}
