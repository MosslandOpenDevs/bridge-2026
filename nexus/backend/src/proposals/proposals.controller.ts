import { Controller, Get, Post, Param, Body, Query } from '@nestjs/common';
import { ProposalsService } from './proposals.service';
import { VoteDto } from './dto/vote.dto';
import type { Proposal, ProposalResult } from '@bridge-2026/shared';

@Controller('api/proposals')
export class ProposalsController {
  constructor(private readonly proposalsService: ProposalsService) {}

  @Get()
  async getProposals(
    @Query('status') status?: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ): Promise<{ proposals: Proposal[]; total: number }> {
    return this.proposalsService.getProposals({
      status,
      limit: limit || 50,
      offset: offset || 0,
    });
  }

  @Get(':id')
  async getProposal(@Param('id') id: string): Promise<Proposal | null> {
    return this.proposalsService.getProposal(id);
  }

  @Post(':id/vote')
  async castVote(
    @Param('id') id: string,
    @Body() voteDto: VoteDto,
  ): Promise<{ success: boolean; txHash?: string; weight: number }> {
    return this.proposalsService.castVote(id, voteDto);
  }

  @Post(':id/tally')
  async tallyVotes(@Param('id') id: string): Promise<ProposalResult> {
    return this.proposalsService.tallyVotes(id);
  }
}
