import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, Length, ValidateNested } from 'class-validator';

const fields = ['POSSIBLE_INCIDENT', 'OVERDUE_INVOICES', 'ALL_ACTIVE_OFFLINE', 'RX_DBM', 'ANY_PPPOE_ONLINE'];
const operators = ['IS_TRUE', 'IS_FALSE', 'GT', 'GTE', 'LT', 'LTE'];
const departments = ['COMMERCIAL', 'FINANCE', 'SUPPORT_N1', 'SUPPORT_N2', 'FIELD'];

export class DiagnosticFlowRuleDto {
  @IsString()
  @Length(1, 80)
  id: string;

  @IsString()
  @Length(1, 100)
  name: string;

  @IsBoolean()
  enabled: boolean;

  @IsIn(fields)
  field: string;

  @IsIn(operators)
  operator: string;

  @IsOptional()
  @IsNumber()
  threshold: number | null;

  @IsIn(departments)
  department: string;

  @IsString()
  @Length(1, 500)
  message: string;
}

export class UpdateDiagnosticFlowDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => DiagnosticFlowRuleDto)
  rules: DiagnosticFlowRuleDto[];
}
