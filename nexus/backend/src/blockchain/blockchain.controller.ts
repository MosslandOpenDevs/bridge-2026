import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ServiceUnavailableException,
} from '@nestjs/common';
import { BlockchainService } from './blockchain.service';
import { toCanonicalAddress } from '../security';

@Controller('api/blockchain')
export class BlockchainController {
  constructor(private readonly blockchainService: BlockchainService) {}

  @Get('balance/:address')
  async getBalance(
    @Param('address') address: string,
  ): Promise<{ address: string; balance: number }> {
    let canonical: string;
    try {
      canonical = toCanonicalAddress(address);
    } catch {
      throw new BadRequestException('address is not a valid address');
    }

    try {
      return {
        address: canonical,
        balance: await this.blockchainService.getBalance(canonical),
      };
    } catch {
      // A 0 here would be indistinguishable from an empty wallet.
      throw new ServiceUnavailableException('Balance lookup failed');
    }
  }

  @Get('total-supply')
  async getTotalSupply(): Promise<{ totalSupply: number }> {
    try {
      return { totalSupply: await this.blockchainService.getTotalSupply() };
    } catch {
      throw new ServiceUnavailableException('Total supply lookup failed');
    }
  }

  @Get('transaction/:txHash')
  async getTransaction(@Param('txHash') txHash: string) {
    const tx = await this.blockchainService.getTransaction(txHash);
    if (!tx) {
      return { error: 'Transaction not found' };
    }
    return {
      hash: tx.hash,
      from: tx.from,
      to: tx.to,
      value: tx.value.toString(),
      blockNumber: tx.blockNumber,
    };
  }
}
