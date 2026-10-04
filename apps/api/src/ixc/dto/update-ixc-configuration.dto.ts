import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateIxcConfigurationDto {
  @IsString() @MaxLength(500) baseUrl: string;
  @IsOptional() @IsString() @MaxLength(2000) token?: string;
  @IsOptional() @IsBoolean() clearToken?: boolean;
}
