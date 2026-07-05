import { Injectable } from '@nestjs/common';
import { ethers } from 'ethers';

@Injectable()
export class BlockchainService {
  private provider: ethers.JsonRpcProvider;
  private mossCoinContract: ethers.Contract;

  constructor() {
    const rpcUrl = process.env.RPC_URL || 'https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY';
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    
    const mossCoinAddress = process.env.MOSS_COIN_ADDRESS || '0x8bbfe65e31b348cd823c62e02ad8c19a84dd0dab';
    const abi = [
      'function balanceOf(address owner) view returns (uint256)',
      'function totalSupply() view returns (uint256)',
    ];
    this.mossCoinContract = new ethers.Contract(mossCoinAddress, abi, this.provider);
  }

  /**
   * Moss Coin 잔액을 조회합니다.
   */
  async getBalance(address: string): Promise<number> {
    try {
      const balance = await this.mossCoinContract.balanceOf(address);
      return parseFloat(ethers.formatEther(balance));
    } catch (error) {
      console.error('Error getting balance:', error);
      return 0;
    }
  }

  /**
   * 총 공급량을 조회합니다.
   */
  async getTotalSupply(): Promise<number> {
    try {
      const supply = await this.mossCoinContract.totalSupply();
      return parseFloat(ethers.formatEther(supply));
    } catch (error) {
      console.error('Error getting total supply:', error);
      return 0;
    }
  }

  /**
   * 트랜잭션을 확인합니다.
   */
  async getTransaction(txHash: string): Promise<ethers.TransactionResponse | null> {
    try {
      return await this.provider.getTransaction(txHash);
    } catch (error) {
      console.error('Error getting transaction:', error);
      return null;
    }
  }

  /**
   * 트랜잭션 영수증을 확인합니다.
   */
  async getTransactionReceipt(txHash: string): Promise<ethers.TransactionReceipt | null> {
    try {
      return await this.provider.getTransactionReceipt(txHash);
    } catch (error) {
      console.error('Error getting transaction receipt:', error);
      return null;
    }
  }
}









