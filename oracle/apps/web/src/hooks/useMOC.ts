"use client";

// Real wallet hooks backed by wagmi. MOC balance is read from Ethereum
// mainnet via the wagmi transport (public RPC by default), matching the
// server-side eligibility check in apps/api.

import { useAccount as useWagmiAccount, useReadContract } from "wagmi";
import { formatUnits } from "viem";
import { MOC_TOKEN_ADDRESS } from "@/lib/config";

// Minimal modern-format ERC-20 ABI (the legacy-format ABI in lib/config.ts
// lacks stateMutability, which wagmi's typed reads require).
const ERC20_READ_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "totalSupply",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

export function useAccount() {
  const { address, isConnected } = useWagmiAccount();
  return { address, isConnected };
}

export function useMOCBalance() {
  const { address } = useWagmiAccount();
  const { data, isLoading, error } = useReadContract({
    address: MOC_TOKEN_ADDRESS,
    abi: ERC20_READ_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: 1,
    query: { enabled: Boolean(address) },
  });

  return {
    balance: (data as bigint | undefined) ?? BigInt(0),
    isLoading,
    error,
  };
}

export function useMOCInfo() {
  const { data: totalSupply, isLoading, error } = useReadContract({
    address: MOC_TOKEN_ADDRESS,
    abi: ERC20_READ_ABI,
    functionName: "totalSupply",
    chainId: 1,
  });

  return {
    name: "Mossland",
    symbol: "MOC",
    decimals: 18,
    totalSupply: (totalSupply as bigint | undefined) ?? BigInt(0),
    isLoading,
    error,
  };
}

export function useVotingPower() {
  const { balance } = useMOCBalance();
  const formatted = Math.floor(Number(formatUnits(balance, 18))).toLocaleString();
  return { votingPower: balance, formatted };
}
