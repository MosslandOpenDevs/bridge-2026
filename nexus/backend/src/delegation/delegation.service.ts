import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { policyEngine } from '@bridge-2026/human-governance';
import type { DelegationPolicy } from '@bridge-2026/shared';
import {
  CreateDelegationPolicyDto,
  DelegationSignatureDto,
} from './dto/create-delegation-policy.dto';
import { DelegationPolicyEntity } from '../entities/delegation-policy.entity';
import {
  buildDelegationMessage,
  canonicalJson,
  isDelegationSignatureRequired,
  toCanonicalAddress,
  verifyDelegationSignature,
} from '../security';

type StoredPolicy = DelegationPolicy & { id: string; createdAt: number };

/**
 * The `delegation_policies` table is the record of truth here.
 *
 * human-governance also ships a `delegationManager` with an in-process map, but
 * it mints its own ids and is never rehydrated from the database, so mirroring
 * writes into it produced entries under ids no request could address and
 * deletions that matched nothing. Only its stateless validator, `policyEngine`,
 * is used.
 */
@Injectable()
export class DelegationService {
  constructor(
    @InjectRepository(DelegationPolicyEntity)
    private policyRepository: Repository<DelegationPolicyEntity>,
  ) {}

  async getAllPolicies(): Promise<StoredPolicy[]> {
    const entities = await this.policyRepository.find({
      order: { createdAt: 'DESC' },
    });
    return entities.map(e => e.toDelegationPolicy());
  }

  async getPoliciesByWallet(wallet: string): Promise<StoredPolicy[]> {
    // Stored addresses are checksummed, so the lookup has to be too or a
    // lower-cased query returns nothing.
    let canonicalWallet: string;
    try {
      canonicalWallet = toCanonicalAddress(wallet);
    } catch {
      throw new BadRequestException('wallet is not a valid address');
    }

    const entities = await this.policyRepository.find({
      where: { wallet: canonicalWallet },
      order: { createdAt: 'DESC' },
    });
    return entities.map(e => e.toDelegationPolicy());
  }

  async createPolicy(createDto: CreateDelegationPolicyDto): Promise<StoredPolicy> {
    let wallet: string;
    try {
      wallet = toCanonicalAddress(createDto.wallet);
    } catch {
      throw new BadRequestException('wallet is not a valid address');
    }

    const scope = createDto.scope ?? {};
    const terms = {
      scope,
      max_budget_per_month: createDto.max_budget_per_month,
      max_budget_per_proposal: createDto.max_budget_per_proposal,
      no_vote_on_emergency: createDto.no_vote_on_emergency,
      cooldown_window_hours: createDto.cooldown_window_hours,
      veto_enabled: createDto.veto_enabled,
      require_human_review_above: createDto.require_human_review_above,
      max_votes_per_day: createDto.max_votes_per_day,
    };

    // One spelling of agent_id everywhere. The signed message trims it, so
    // signing "alice" and storing "  alice  " would let the value be changed
    // after signing — and the padded string is what the indexed column and any
    // executor would then match on.
    const agentId = createDto.agent_id.trim();
    if (!agentId) {
      throw new BadRequestException('agent_id is required');
    }

    // A policy hands an agent this wallet's voting influence, so the wallet has
    // to authorize it. The signed message covers the terms as well as the
    // wallet: otherwise a captured signature could be re-submitted with the
    // budget caps removed.
    if (isDelegationSignatureRequired()) {
      const message = buildDelegationMessage({
        action: 'create',
        wallet,
        agentId,
        policy: canonicalJson(terms),
        nonce: createDto.nonce || '',
        timestamp: createDto.timestamp || 0,
      });
      const sig = await verifyDelegationSignature({
        message,
        wallet,
        signature: createDto.signature,
        nonce: createDto.nonce,
        timestamp: createDto.timestamp,
      });
      if (!sig.ok) {
        throw new UnauthorizedException(
          sig.reason || 'Delegation signature verification failed',
        );
      }
    }

    const validation = policyEngine.validatePolicy({
      wallet,
      agent_id: agentId,
      ...terms,
    });
    if (!validation.valid) {
      throw new BadRequestException(validation.errors);
    }

    const entity = this.policyRepository.create({
      wallet,
      agent_id: agentId,
      scope,
      max_budget_per_month: createDto.max_budget_per_month ?? null,
      max_budget_per_proposal: createDto.max_budget_per_proposal ?? null,
      no_vote_on_emergency: createDto.no_vote_on_emergency,
      cooldown_window_hours: createDto.cooldown_window_hours,
      veto_enabled: createDto.veto_enabled,
      require_human_review_above: createDto.require_human_review_above ?? null,
      max_votes_per_day: createDto.max_votes_per_day ?? null,
    });

    const saved = await this.policyRepository.save(entity);
    return saved.toDelegationPolicy();
  }

  async deletePolicy(
    id: string,
    proof: DelegationSignatureDto,
  ): Promise<{ success: boolean }> {
    const entity = await this.policyRepository.findOne({ where: { id } });
    if (!entity) {
      throw new NotFoundException(`Policy ${id} not found`);
    }

    // Revocation is as sensitive as creation: without proof of ownership anyone
    // who learns a policy id could strip another holder's delegation.
    if (isDelegationSignatureRequired()) {
      let wallet: string;
      try {
        wallet = toCanonicalAddress(entity.wallet);
      } catch {
        throw new BadRequestException(
          "This policy's wallet is not a valid address and cannot be verified",
        );
      }
      const message = buildDelegationMessage({
        action: 'delete',
        wallet,
        policyId: entity.id,
        nonce: proof.nonce || '',
        timestamp: proof.timestamp || 0,
      });
      const sig = await verifyDelegationSignature({
        message,
        wallet,
        signature: proof.signature,
        nonce: proof.nonce,
        timestamp: proof.timestamp,
      });
      if (!sig.ok) {
        throw new UnauthorizedException(
          sig.reason || 'Delegation signature verification failed',
        );
      }
    }

    await this.policyRepository.remove(entity);
    return { success: true };
  }
}
