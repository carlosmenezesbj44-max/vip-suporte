import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';
import { UserRole } from '@canal-direto/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { IxcService } from './ixc.service';
import { UpdateIxcConfigurationDto } from './dto/update-ixc-configuration.dto';
import { SearchCustomerByCpfDto } from './dto/search-customer-by-cpf.dto';
import { SearchCustomerDto } from './dto/search-customer.dto';

@Controller('ixc')
export class IxcController {
  constructor(private readonly ixcService: IxcService) {}

  @Get('status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.AGENT, UserRole.TECHNICIAN, UserRole.ADMIN)
  getStatus() {
    return this.ixcService.getConfigurationStatus();
  }

  @Put('config')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  saveConfiguration(@Body() dto: UpdateIxcConfigurationDto) {
    return this.ixcService.saveConfiguration(dto);
  }

  @Post('test')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  testConnection() {
    return this.ixcService.testConnection();
  }

  @Post('customer/by-cpf')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.AGENT, UserRole.TECHNICIAN, UserRole.ADMIN)
  searchCustomerByCpf(@Body() dto: SearchCustomerByCpfDto) {
    return this.ixcService.searchCustomerByDocument(dto.cpf);
  }

  @Post('customer/search')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.AGENT, UserRole.TECHNICIAN, UserRole.ADMIN)
  searchCustomer(@Body() dto: SearchCustomerDto) {
    return this.ixcService.searchCustomers(dto.query);
  }

  @Post('customer/verify')
  async verifyCustomerForTicket(@Body() dto: SearchCustomerDto) {
    const customers = await this.ixcService.searchCustomers(dto.query);
    return customers.map((customer) => ({
      id: customer.id,
      name: customer.razaoSocial,
      documentHint: customer.cpfCnpj ? `Documento final ··${customer.cpfCnpj.replace(/\D/g, '').slice(-2)}` : null,
      contractStatus: customer.situacaoContrato,
    }));
  }
}
