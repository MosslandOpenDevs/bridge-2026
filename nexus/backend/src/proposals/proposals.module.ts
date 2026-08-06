import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProposalsController } from './proposals.controller';
import { ProposalsService } from './proposals.service';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { ProposalEntity } from '../entities/proposal.entity';
import { ProposalResultEntity } from '../entities/proposal-result.entity';
import { VoteEntity } from '../entities/vote.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ProposalEntity,
      ProposalResultEntity,
      VoteEntity,
    ]),
    BlockchainModule,
  ],
  controllers: [ProposalsController],
  providers: [ProposalsService],
  exports: [ProposalsService],
})
export class ProposalsModule {}

