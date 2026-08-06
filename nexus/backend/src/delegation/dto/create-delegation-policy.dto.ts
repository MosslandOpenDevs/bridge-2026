import {
  IsString,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsArray,
  IsInt,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class ScopeDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  categories?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  exclude_categories?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  exclude_tags?: string[];
}

/**
 * Proof that the wallet authorized the change. Creation and deletion both carry
 * it, because revoking a policy is as consequential as granting one.
 */
export class DelegationSignatureDto {
  @IsOptional()
  @Matches(/^0x[0-9a-fA-F]+$/, { message: 'signature must be hex' })
  signature?: string;

  @IsOptional()
  @IsString()
  nonce?: string;

  /** Epoch milliseconds the message was signed at. */
  @IsOptional()
  @IsInt()
  timestamp?: number;
}

export class CreateDelegationPolicyDto extends DelegationSignatureDto {
  @Matches(/^0x[0-9a-fA-F]{40}$/, {
    message: 'wallet must be a 0x-prefixed 20-byte address',
  })
  wallet: string;

  @IsString()
  agent_id: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ScopeDto)
  scope?: ScopeDto;

  @IsOptional()
  @IsNumber()
  @Min(0)
  max_budget_per_month?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  max_budget_per_proposal?: number;

  @IsBoolean()
  no_vote_on_emergency: boolean;

  @IsNumber()
  @Min(0)
  cooldown_window_hours: number;

  @IsBoolean()
  veto_enabled: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  require_human_review_above?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  max_votes_per_day?: number;
}
