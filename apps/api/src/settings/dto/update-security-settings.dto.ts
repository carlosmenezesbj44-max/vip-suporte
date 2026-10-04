import { IsInt, Max, Min } from 'class-validator';

export class UpdateSecuritySettingsDto {
  @IsInt() @Min(8) @Max(64) passwordMinLength: number;
  @IsInt() @Min(1) @Max(30) sessionDurationDays: number;
}
