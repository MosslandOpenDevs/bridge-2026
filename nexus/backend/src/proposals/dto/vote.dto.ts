import { IsString, IsIn, IsOptional, IsInt, Matches } from 'class-validator';

export class VoteDto {
  /**
   * Any 0x address is accepted here and canonicalized in the service; the
   * signature below is what proves the caller actually controls it.
   */
  @Matches(/^0x[0-9a-fA-F]{40}$/, {
    message: 'voterAddress must be a 0x-prefixed 20-byte address',
  })
  voterAddress: string;

  @IsIn(['yes', 'no', 'abstain'])
  choice: 'yes' | 'no' | 'abstain';

  /**
   * personal_sign of the message built by buildVoteMessage() in src/security.ts.
   * Optional at the DTO level so a request that omits it fails with 401 and the
   * verifier's reason instead of a shape error, and so a demo run with
   * REQUIRE_VOTE_SIGNATURE=never still validates.
   */
  @IsOptional()
  @Matches(/^0x[0-9a-fA-F]+$/, { message: 'signature must be hex' })
  signature?: string;

  /** Single-use value; the same nonce is refused on a second vote. */
  @IsOptional()
  @IsString()
  nonce?: string;

  /** Epoch milliseconds the message was signed at; bounds the replay window. */
  @IsOptional()
  @IsInt()
  timestamp?: number;

  @IsOptional()
  @IsString()
  txHash?: string;
}
