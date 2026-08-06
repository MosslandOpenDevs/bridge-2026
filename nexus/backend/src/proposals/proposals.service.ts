import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import type { Proposal, ProposalResult, Vote } from '@bridge-2026/shared';
import { ProposalStatus } from '@bridge-2026/shared';
import { VoteDto } from './dto/vote.dto';
import { BlockchainService } from '../blockchain/blockchain.service';
import { ProposalEntity } from '../entities/proposal.entity';
import { ProposalResultEntity } from '../entities/proposal-result.entity';
import { VoteEntity } from '../entities/vote.entity';
import {
  isVoteSignatureRequired,
  toCanonicalAddress,
  verifyVoteSignature,
} from '../security';

/** Postgres unique_violation, raised by the (proposal_id, voter_address) key. */
const PG_UNIQUE_VIOLATION = '23505';

@Injectable()
export class ProposalsService {
  constructor(
    @InjectRepository(ProposalEntity)
    private proposalRepository: Repository<ProposalEntity>,
    @InjectRepository(VoteEntity)
    private voteRepository: Repository<VoteEntity>,
    @InjectRepository(ProposalResultEntity)
    private resultRepository: Repository<ProposalResultEntity>,
    private readonly blockchainService: BlockchainService,
  ) {}

  async getProposals(options: {
    status?: string;
    limit: number;
    offset: number;
  }): Promise<{ proposals: Proposal[]; total: number }> {
    const queryBuilder = this.proposalRepository.createQueryBuilder('proposal');

    if (options.status) {
      queryBuilder.where('proposal.status = :status', {
        status: options.status,
      });
    }

    const total = await queryBuilder.getCount();

    const entities = await queryBuilder
      .orderBy('proposal.createdAt', 'DESC')
      .skip(options.offset)
      .take(options.limit)
      .getMany();

    const proposals = entities.map(e => e.toProposal());

    return { proposals, total };
  }

  async getProposal(id: string): Promise<Proposal | null> {
    const entity = await this.proposalRepository.findOne({
      where: { id },
      relations: ['votes'],
    });

    return entity ? entity.toProposal() : null;
  }

  async castVote(
    proposalId: string,
    voteDto: VoteDto,
  ): Promise<{ success: boolean; txHash?: string; weight: number }> {
    const proposal = await this.proposalRepository.findOne({
      where: { id: proposalId },
    });

    if (!proposal) {
      throw new NotFoundException(`Proposal ${proposalId} not found`);
    }

    if (proposal.status !== ProposalStatus.ACTIVE) {
      throw new BadRequestException(`Proposal ${proposalId} is not active`);
    }

    // Canonicalize before anything else looks at the address: the duplicate
    // check, the signed message, the stored row and the tally must all agree on
    // one spelling, or the same holder votes twice by changing the casing.
    let voterAddress: string;
    try {
      voterAddress = toCanonicalAddress(voteDto.voterAddress);
    } catch {
      throw new BadRequestException('voterAddress is not a valid address');
    }

    // The weight of this vote is that address's Moss Coin balance, so without a
    // signature anyone could spend any holder's stake by naming their address.
    if (isVoteSignatureRequired()) {
      const sig = await verifyVoteSignature({
        voter: voterAddress,
        proposalId,
        choice: voteDto.choice,
        signature: voteDto.signature,
        nonce: voteDto.nonce,
        timestamp: voteDto.timestamp,
      });
      if (!sig.ok) {
        throw new UnauthorizedException(
          sig.reason || 'Vote signature verification failed',
        );
      }
    }

    const existingVote = await this.voteRepository.findOne({
      where: { proposalId, voterAddress },
    });

    if (existingVote) {
      throw new ConflictException('Already voted');
    }

    // Allowed to throw. A balance lookup that failed must not be recorded as a
    // zero-weight vote: that marks the holder as having voted while counting
    // none of their stake, and the duplicate check then blocks the retry.
    const weight = await this.blockchainService.getBalance(voterAddress);

    const voteEntity = this.voteRepository.create({
      proposalId,
      voterAddress,
      choice: voteDto.choice,
      weight,
      txHash: voteDto.txHash ?? null,
    });

    try {
      await this.voteRepository.save(voteEntity);
    } catch (error) {
      // The lookup above is not atomic, so two concurrent requests can both
      // pass it; the unique constraint is what actually enforces one vote per
      // holder per proposal.
      if (
        error instanceof QueryFailedError &&
        (error as QueryFailedError & { code?: string }).code ===
          PG_UNIQUE_VIOLATION
      ) {
        throw new ConflictException('Already voted');
      }
      throw error;
    }

    return {
      success: true,
      txHash: voteEntity.txHash ?? undefined,
      weight,
    };
  }

  /**
   * Recomputes the tally from the `votes` rows and stores it as the proposal's
   * `proposal_results` row. Votes remain the record of truth; the result row is
   * a cached summary keyed by proposal.
   *
   * A stored result is never replaced. `proposal_results` is keyed by proposal,
   * so a re-tally overwrites in place — and because participation falls back to
   * 0 when the chain cannot be reached, re-tallying a settled proposal during
   * an RPC outage would quietly rewrite a `passed: true` outcome to `false`.
   */
  async tallyVotes(proposalId: string): Promise<ProposalResult> {
    const proposal = await this.proposalRepository.findOne({
      where: { id: proposalId },
    });

    if (!proposal) {
      throw new NotFoundException(`Proposal ${proposalId} not found`);
    }

    const existing = await this.resultRepository.findOne({
      where: { proposalId },
    });
    if (existing) {
      return existing.toResult();
    }

    const votes = (
      await this.voteRepository.find({ where: { proposalId } })
    ).map(v => v.toVote());

    const countOf = (choice: Vote['choice']) =>
      votes.filter(v => v.choice === choice).length;
    const weightOf = (choice: Vote['choice']) =>
      votes
        .filter(v => v.choice === choice)
        .reduce((sum, v) => sum + v.weight, 0);

    const yesWeight = weightOf('yes');
    const noWeight = weightOf('no');
    const abstainWeight = weightOf('abstain');
    const totalWeight = yesWeight + noWeight + abstainWeight;

    // Participation is measured against circulating Moss Coin. When the supply
    // cannot be read it stays 0, which fails a minimum-participation
    // requirement closed instead of passing a proposal on an unknown quorum.
    let totalSupply = 0;
    try {
      totalSupply = await this.blockchainService.getTotalSupply();
    } catch {
      totalSupply = 0;
    }
    const participationRate =
      totalSupply > 0 ? Math.min(1, totalWeight / totalSupply) : 0;

    // Abstentions count towards participation but not towards the ratio; that
    // is what makes abstaining different from not voting at all.
    const decisiveWeight = yesWeight + noWeight;
    const passed =
      decisiveWeight > 0 &&
      participationRate >= (proposal.minParticipationRate ?? 0) &&
      yesWeight / decisiveWeight >= (proposal.passingThreshold ?? 0.5);

    const result = this.resultRepository.create({
      proposalId,
      totalVotes: votes.length,
      yesVotes: countOf('yes'),
      noVotes: countOf('no'),
      abstainVotes: countOf('abstain'),
      totalWeight,
      yesWeight,
      noWeight,
      abstainWeight,
      passed,
      participationRate,
    });

    const saved = await this.resultRepository.save(result);
    return saved.toResult();
  }
}
