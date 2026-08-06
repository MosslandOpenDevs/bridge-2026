/**
 * Blockchain Service
 *
 * Provides on-chain interaction for governance operations
 * using the OracleGovernance contract.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toBytes,
  type Address,
  type Hash,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet, sepolia, hardhat } from "viem/chains";
import { canonicalJson } from "./security.js";

// MOC Token address on Ethereum mainnet
const MOC_TOKEN_ADDRESS = "0x8bbfe65e31b348cd823c62e02ad8c19a84dd0dab" as Address;

// ERC20 ABI for MOC token balance check
const ERC20_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "decimals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    name: "symbol",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
] as const;

// OracleGovernance ABI (minimal interface for our needs)
const ORACLE_GOVERNANCE_ABI = [
  {
    name: "createProposal",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "decisionPacketHash", type: "bytes32" },
      { name: "metadataURI", type: "string" },
      { name: "quorum", type: "uint256" },
      { name: "threshold", type: "uint256" },
      { name: "votingPeriod", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "castVote",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "proposalId", type: "uint256" },
      { name: "choice", type: "uint8" },
      { name: "weight", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "finalizeProposal",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "proposalId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "executeProposal",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "proposalId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "recordOutcome",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "proposalId", type: "uint256" },
      { name: "proofHash", type: "bytes32" },
      { name: "successRate", type: "uint256" },
      { name: "overallSuccess", type: "bool" },
    ],
    outputs: [],
  },
  {
    name: "getProposal",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "proposalId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "id", type: "uint256" },
          { name: "proposer", type: "address" },
          { name: "decisionPacketHash", type: "bytes32" },
          { name: "metadataURI", type: "string" },
          { name: "votingStartTime", type: "uint256" },
          { name: "votingEndTime", type: "uint256" },
          { name: "quorum", type: "uint256" },
          { name: "threshold", type: "uint256" },
          { name: "status", type: "uint8" },
          { name: "forVotes", type: "uint256" },
          { name: "againstVotes", type: "uint256" },
          { name: "abstainVotes", type: "uint256" },
        ],
      },
    ],
  },
  {
    name: "isVotingActive",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "proposalId", type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
  {
    name: "hasVoted",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "proposalId", type: "uint256" },
      { name: "voter", type: "address" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    name: "proposalCount",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  // Events
  {
    name: "ProposalCreated",
    type: "event",
    inputs: [
      { name: "proposalId", type: "uint256", indexed: true },
      { name: "proposer", type: "address", indexed: true },
      { name: "decisionPacketHash", type: "bytes32", indexed: false },
      { name: "metadataURI", type: "string", indexed: false },
    ],
  },
  {
    name: "VoteCast",
    type: "event",
    inputs: [
      { name: "proposalId", type: "uint256", indexed: true },
      { name: "voter", type: "address", indexed: true },
      { name: "choice", type: "uint8", indexed: false },
      { name: "weight", type: "uint256", indexed: false },
    ],
  },
  {
    name: "ProposalExecuted",
    type: "event",
    inputs: [{ name: "proposalId", type: "uint256", indexed: true }],
  },
  {
    name: "OutcomeRecorded",
    type: "event",
    inputs: [
      { name: "proposalId", type: "uint256", indexed: true },
      { name: "proofHash", type: "bytes32", indexed: false },
      { name: "success", type: "bool", indexed: false },
    ],
  },
] as const;

// Vote choice enum (matches contract)
export enum VoteChoice {
  For = 0,
  Against = 1,
  Abstain = 2,
}

// Proposal status enum (matches contract)
export enum ProposalStatus {
  Pending = 0,
  Active = 1,
  Passed = 2,
  Rejected = 3,
  Executed = 4,
  Cancelled = 5,
}

// On-chain proposal type
export interface OnChainProposal {
  id: bigint;
  proposer: Address;
  decisionPacketHash: `0x${string}`;
  metadataURI: string;
  votingStartTime: bigint;
  votingEndTime: bigint;
  quorum: bigint;
  threshold: bigint;
  status: ProposalStatus;
  forVotes: bigint;
  againstVotes: bigint;
  abstainVotes: bigint;
}

// Transaction result type
export interface TxResult {
  success: boolean;
  txHash?: Hash;
  error?: string;
  onchainId?: number;
}

/**
 * Blockchain service for on-chain governance operations
 */
export class BlockchainService {
  private publicClient: PublicClient | null = null;
  private walletClient: WalletClient | null = null;
  private mainnetClient: PublicClient | null = null; // For MOC token on mainnet
  private contractAddress: Address | null = null;
  private account: ReturnType<typeof privateKeyToAccount> | null = null;
  private enabled: boolean = false;
  private mocEnabled: boolean = false;

  constructor() {
    this.initialize();
  }

  private initialize() {
    const rpcUrl = process.env.RPC_URL;
    const privateKey = process.env.ORACLE_PRIVATE_KEY;
    const contractAddress = process.env.GOVERNANCE_CONTRACT_ADDRESS;
    const chainId = process.env.CHAIN_ID || "31337"; // Default to hardhat
    // MOC balance checks are read-only, so a public RPC is enough to enable
    // them out of the box. Set MAINNET_RPC_URL=off to force demo mode, or set
    // a dedicated (e.g. Alchemy/Infura) URL for production reliability.
    const configuredMainnetRpc = process.env.MAINNET_RPC_URL || process.env.ETHERSCAN_RPC_URL;
    const mainnetRpcUrl =
      configuredMainnetRpc === "off"
        ? undefined
        : configuredMainnetRpc || "https://ethereum-rpc.publicnode.com";

    // Initialize mainnet client for MOC token balance checks
    if (mainnetRpcUrl) {
      try {
        this.mainnetClient = createPublicClient({
          chain: mainnet,
          transport: http(mainnetRpcUrl),
        });
        this.mocEnabled = true;
        console.log(`🪙 MOC token service enabled (${MOC_TOKEN_ADDRESS})`);
      } catch (error) {
        console.warn("⚠️  MOC token service disabled:", error);
      }
    } else {
      console.log("⚠️  MOC token service disabled: MAINNET_RPC_URL=off");
    }

    if (!rpcUrl || !privateKey || !contractAddress) {
      console.log("⚠️  Blockchain service disabled: Missing RPC_URL, ORACLE_PRIVATE_KEY, or GOVERNANCE_CONTRACT_ADDRESS");
      return;
    }

    try {
      // Select chain based on chainId
      const chain = chainId === "1" ? mainnet : chainId === "11155111" ? sepolia : hardhat;

      // Create public client for read operations
      this.publicClient = createPublicClient({
        chain,
        transport: http(rpcUrl),
      });

      // Create account from private key
      this.account = privateKeyToAccount(privateKey as `0x${string}`);

      // Create wallet client for write operations
      this.walletClient = createWalletClient({
        account: this.account,
        chain,
        transport: http(rpcUrl),
      });

      this.contractAddress = contractAddress as Address;
      this.enabled = true;

      console.log(`🔗 Blockchain service enabled:`);
      console.log(`   Chain: ${chain.name} (${chain.id})`);
      console.log(`   Contract: ${contractAddress}`);
      console.log(`   Account: ${this.account.address}`);
    } catch (error) {
      console.error("❌ Failed to initialize blockchain service:", error);
    }
  }

  /**
   * Check if blockchain service is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Check if MOC token service is enabled
   */
  isMocEnabled(): boolean {
    return this.mocEnabled;
  }

  /**
   * Get MOC token balance for an address
   * Returns balance in wei (18 decimals)
   */
  async getMocBalance(address: Address): Promise<bigint> {
    if (!this.mocEnabled || !this.mainnetClient) {
      throw new Error("MOC token service not enabled");
    }

    try {
      const balance = await this.mainnetClient.readContract({
        address: MOC_TOKEN_ADDRESS,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [address],
      });
      return balance;
    } catch (error) {
      console.error("Failed to get MOC balance:", error);
      throw error;
    }
  }

  /**
   * Current mainnet block height, used to pin a proposal's voting snapshot.
   */
  async getCurrentBlockNumber(): Promise<number> {
    if (!this.mocEnabled || !this.mainnetClient) {
      throw new Error("MOC token service not enabled");
    }
    const block = await this.mainnetClient.getBlockNumber();
    return Number(block);
  }

  /**
   * MOC balance as of a specific block.
   *
   * Voting power must come from a fixed point in the past: reading the balance
   * at vote time lets one holder vote, forward the tokens to another wallet,
   * and vote again with the same coins.
   *
   * Historical state requires an archive-capable RPC. Failures are propagated
   * rather than falling back to the live balance — a silently "current"
   * weight is exactly the bug this exists to prevent.
   */
  async getMocBalanceAt(address: Address, blockNumber: number): Promise<bigint> {
    if (!this.mocEnabled || !this.mainnetClient) {
      throw new Error("MOC token service not enabled");
    }

    try {
      return await this.mainnetClient.readContract({
        address: MOC_TOKEN_ADDRESS,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [address],
        blockNumber: BigInt(blockNumber),
      });
    } catch (error: any) {
      throw new Error(
        `Could not read the MOC balance of ${address} at block ${blockNumber}: ` +
          `${error?.shortMessage || error?.message || "unknown error"}. ` +
          "Snapshot voting needs an archive-capable RPC (set MAINNET_RPC_URL), " +
          "or set VOTE_WEIGHT_MODE=current to accept live balances.",
      );
    }
  }

  /**
   * Get MOC token balance formatted (human-readable)
   */
  async getMocBalanceFormatted(address: Address): Promise<string> {
    const balance = await this.getMocBalance(address);
    // MOC has 18 decimals
    const formatted = Number(balance) / 1e18;
    return formatted.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  /**
   * Check if address is a MOC holder (has balance > 0)
   */
  async isMocHolder(address: Address): Promise<boolean> {
    try {
      const balance = await this.getMocBalance(address);
      return balance > 0n;
    } catch {
      return false;
    }
  }

  /**
   * Verify voter eligibility - must hold MOC tokens
   * Returns the voting weight (MOC balance) if eligible, throws if not
   */
  async verifyVoterEligibility(address: Address): Promise<bigint> {
    if (!this.mocEnabled) {
      // If MOC service not enabled, allow voting with provided weight
      console.warn("⚠️  MOC verification disabled - allowing vote without balance check");
      return 0n;
    }

    const balance = await this.getMocBalance(address);
    if (balance === 0n) {
      throw new Error(`Address ${address} is not a MOC holder. Only MOC token holders can vote.`);
    }
    return balance;
  }

  /**
   * Hash a decision packet for on-chain storage.
   * Uses canonical JSON (sorted keys) so the same packet always produces the same hash.
   */
  hashDecisionPacket(decisionPacket: any): `0x${string}` {
    return keccak256(toBytes(canonicalJson(decisionPacket)));
  }

  /**
   * Create a proposal on-chain
   */
  async createProposal(
    decisionPacket: any,
    metadataURI: string,
    quorum: number = 0,
    threshold: number = 0,
    votingPeriod: number = 0
  ): Promise<TxResult> {
    if (!this.enabled || !this.walletClient || !this.publicClient || !this.contractAddress || !this.account) {
      return { success: false, error: "Blockchain service not enabled" };
    }

    try {
      const decisionPacketHash = this.hashDecisionPacket(decisionPacket);

      // Simulate the transaction first
      const { request } = await this.publicClient.simulateContract({
        address: this.contractAddress,
        abi: ORACLE_GOVERNANCE_ABI,
        functionName: "createProposal",
        args: [
          decisionPacketHash,
          metadataURI,
          BigInt(quorum),
          BigInt(threshold),
          BigInt(votingPeriod),
        ],
        account: this.account,
      });

      // Execute the transaction
      const txHash = await this.walletClient.writeContract(request);

      // Wait for confirmation
      const receipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash });

      // Get the proposal ID from events
      const proposalCount = await this.publicClient.readContract({
        address: this.contractAddress,
        abi: ORACLE_GOVERNANCE_ABI,
        functionName: "proposalCount",
      });

      console.log(`✅ On-chain proposal created: ${txHash}`);

      return {
        success: receipt.status === "success",
        txHash,
        onchainId: Number(proposalCount),
      };
    } catch (error: any) {
      console.error("❌ Failed to create on-chain proposal:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Cast a vote on-chain
   */
  async castVote(
    proposalId: number,
    choice: VoteChoice,
    weight: bigint
  ): Promise<TxResult> {
    if (!this.enabled || !this.walletClient || !this.publicClient || !this.contractAddress || !this.account) {
      return { success: false, error: "Blockchain service not enabled" };
    }

    try {
      // Simulate the transaction first
      const { request } = await this.publicClient.simulateContract({
        address: this.contractAddress,
        abi: ORACLE_GOVERNANCE_ABI,
        functionName: "castVote",
        args: [BigInt(proposalId), choice, weight],
        account: this.account,
      });

      // Execute the transaction
      const txHash = await this.walletClient.writeContract(request);

      // Wait for confirmation
      const receipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash });

      console.log(`✅ On-chain vote cast: ${txHash}`);

      return {
        success: receipt.status === "success",
        txHash,
      };
    } catch (error: any) {
      console.error("❌ Failed to cast on-chain vote:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Finalize a proposal on-chain
   */
  async finalizeProposal(proposalId: number): Promise<TxResult> {
    if (!this.enabled || !this.walletClient || !this.publicClient || !this.contractAddress || !this.account) {
      return { success: false, error: "Blockchain service not enabled" };
    }

    try {
      const { request } = await this.publicClient.simulateContract({
        address: this.contractAddress,
        abi: ORACLE_GOVERNANCE_ABI,
        functionName: "finalizeProposal",
        args: [BigInt(proposalId)],
        account: this.account,
      });

      const txHash = await this.walletClient.writeContract(request);
      const receipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash });

      console.log(`✅ On-chain proposal finalized: ${txHash}`);

      return {
        success: receipt.status === "success",
        txHash,
      };
    } catch (error: any) {
      console.error("❌ Failed to finalize on-chain proposal:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Execute a proposal on-chain
   */
  async executeProposal(proposalId: number): Promise<TxResult> {
    if (!this.enabled || !this.walletClient || !this.publicClient || !this.contractAddress || !this.account) {
      return { success: false, error: "Blockchain service not enabled" };
    }

    try {
      const { request } = await this.publicClient.simulateContract({
        address: this.contractAddress,
        abi: ORACLE_GOVERNANCE_ABI,
        functionName: "executeProposal",
        args: [BigInt(proposalId)],
        account: this.account,
      });

      const txHash = await this.walletClient.writeContract(request);
      const receipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash });

      console.log(`✅ On-chain proposal executed: ${txHash}`);

      return {
        success: receipt.status === "success",
        txHash,
      };
    } catch (error: any) {
      console.error("❌ Failed to execute on-chain proposal:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Record outcome proof on-chain
   */
  async recordOutcome(
    proposalId: number,
    proofHash: `0x${string}`,
    successRate: number,
    overallSuccess: boolean
  ): Promise<TxResult> {
    if (!this.enabled || !this.walletClient || !this.publicClient || !this.contractAddress || !this.account) {
      return { success: false, error: "Blockchain service not enabled" };
    }

    try {
      const { request } = await this.publicClient.simulateContract({
        address: this.contractAddress,
        abi: ORACLE_GOVERNANCE_ABI,
        functionName: "recordOutcome",
        args: [BigInt(proposalId), proofHash, BigInt(Math.round(successRate * 100)), overallSuccess],
        account: this.account,
      });

      const txHash = await this.walletClient.writeContract(request);
      const receipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash });

      console.log(`✅ On-chain outcome recorded: ${txHash}`);

      return {
        success: receipt.status === "success",
        txHash,
      };
    } catch (error: any) {
      console.error("❌ Failed to record on-chain outcome:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get proposal from on-chain
   */
  async getProposal(proposalId: number): Promise<OnChainProposal | null> {
    if (!this.enabled || !this.publicClient || !this.contractAddress) {
      return null;
    }

    try {
      const proposal = await this.publicClient.readContract({
        address: this.contractAddress,
        abi: ORACLE_GOVERNANCE_ABI,
        functionName: "getProposal",
        args: [BigInt(proposalId)],
      });

      return {
        id: proposal.id,
        proposer: proposal.proposer,
        decisionPacketHash: proposal.decisionPacketHash,
        metadataURI: proposal.metadataURI,
        votingStartTime: proposal.votingStartTime,
        votingEndTime: proposal.votingEndTime,
        quorum: proposal.quorum,
        threshold: proposal.threshold,
        status: proposal.status as ProposalStatus,
        forVotes: proposal.forVotes,
        againstVotes: proposal.againstVotes,
        abstainVotes: proposal.abstainVotes,
      };
    } catch (error) {
      console.error("Failed to get on-chain proposal:", error);
      return null;
    }
  }

  /**
   * Check if voting is active for a proposal
   */
  async isVotingActive(proposalId: number): Promise<boolean> {
    if (!this.enabled || !this.publicClient || !this.contractAddress) {
      return false;
    }

    try {
      return await this.publicClient.readContract({
        address: this.contractAddress,
        abi: ORACLE_GOVERNANCE_ABI,
        functionName: "isVotingActive",
        args: [BigInt(proposalId)],
      });
    } catch (error) {
      return false;
    }
  }

  /**
   * Check if an address has voted on a proposal
   */
  async hasVoted(proposalId: number, voter: Address): Promise<boolean> {
    if (!this.enabled || !this.publicClient || !this.contractAddress) {
      return false;
    }

    try {
      return await this.publicClient.readContract({
        address: this.contractAddress,
        abi: ORACLE_GOVERNANCE_ABI,
        functionName: "hasVoted",
        args: [BigInt(proposalId), voter],
      });
    } catch (error) {
      return false;
    }
  }

  /**
   * Get current proposal count
   */
  async getProposalCount(): Promise<number> {
    if (!this.enabled || !this.publicClient || !this.contractAddress) {
      return 0;
    }

    try {
      const count = await this.publicClient.readContract({
        address: this.contractAddress,
        abi: ORACLE_GOVERNANCE_ABI,
        functionName: "proposalCount",
      });
      return Number(count);
    } catch (error) {
      return 0;
    }
  }
}

// Singleton instance
export const blockchainService = new BlockchainService();

// Helper to convert vote choice string to enum
export function parseVoteChoice(choice: string): VoteChoice {
  switch (choice.toLowerCase()) {
    case "for":
      return VoteChoice.For;
    case "against":
      return VoteChoice.Against;
    case "abstain":
    default:
      return VoteChoice.Abstain;
  }
}
