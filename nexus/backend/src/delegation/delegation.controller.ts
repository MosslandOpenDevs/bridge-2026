import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { DelegationService } from './delegation.service';
import {
  CreateDelegationPolicyDto,
  DelegationSignatureDto,
} from './dto/create-delegation-policy.dto';
import type { DelegationPolicy } from '@bridge-2026/shared';

type StoredPolicy = DelegationPolicy & { id: string; createdAt: number };

@Controller('api/delegation')
export class DelegationController {
  constructor(private readonly delegationService: DelegationService) {}

  @Get('policies')
  async getPolicies(@Query('wallet') wallet?: string): Promise<StoredPolicy[]> {
    if (wallet) {
      return this.delegationService.getPoliciesByWallet(wallet);
    }
    return this.delegationService.getAllPolicies();
  }

  @Post('policies')
  async createPolicy(
    @Body() createDto: CreateDelegationPolicyDto,
  ): Promise<StoredPolicy> {
    return this.delegationService.createPolicy(createDto);
  }

  /**
   * Takes a body, unusually for DELETE: revoking a delegation needs the same
   * wallet signature that creating one does, and a signature does not belong in
   * a URL where proxies and access logs would retain it.
   */
  @Delete('policies/:id')
  async deletePolicy(
    @Param('id') id: string,
    @Body() proof: DelegationSignatureDto,
  ): Promise<{ success: boolean }> {
    return this.delegationService.deletePolicy(id, proof);
  }
}
