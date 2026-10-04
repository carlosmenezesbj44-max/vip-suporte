import { Transform } from 'class-transformer';
import { IsString, Matches } from 'class-validator';

export class SearchCustomerByCpfDto {
  @Transform(({ value }) => typeof value === 'string' ? value.replace(/\D/g, '') : value)
  @IsString()
  @Matches(/^\d{11}$/, { message: 'Informe um CPF com 11 dígitos' })
  cpf: string;
}
