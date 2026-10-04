import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class SearchCustomerDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MinLength(3, { message: 'Digite pelo menos 3 caracteres para pesquisar' })
  @MaxLength(100, { message: 'A busca pode ter no máximo 100 caracteres' })
  query: string;
}
