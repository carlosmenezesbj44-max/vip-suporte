import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { TicketCategory } from '@canal-direto/shared';

export class CreateTicketDto {
  @IsNotEmpty()
  title: string;

  @IsNotEmpty()
  description: string;

  @IsEnum(TicketCategory)
  category: TicketCategory;

  /** CPF/CNPJ do cliente, usado para vincular com o cadastro no IXC. */
  @IsOptional()
  cpfCnpj?: string;

  /** Busca original usada para confirmar o cadastro selecionado no IXC. */
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  ixcSearchTerm?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  ixcCustomerId?: string;
}
