import { mainnet, sepolia } from "wagmi/chains";
import { getDefaultConfig } from "@rainbow-me/rainbowkit";

// MOC Token Contract Address (Ethereum Mainnet)
export const MOC_TOKEN_ADDRESS = "0x8bbfe65e31b348cd823c62e02ad8c19a84dd0dab" as const;

// MOC Token ABI (ERC-20 standard functions)
export const MOC_TOKEN_ABI = [
  {
    constant: true,
    inputs: [{ name: "_owner", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "balance", type: "uint256" }],
    type: "function",
  },
  {
    constant: true,
    inputs: [],
    name: "totalSupply",
    outputs: [{ name: "", type: "uint256" }],
    type: "function",
  },
  {
    constant: true,
    inputs: [],
    name: "decimals",
    outputs: [{ name: "", type: "uint8" }],
    type: "function",
  },
  {
    constant: true,
    inputs: [],
    name: "symbol",
    outputs: [{ name: "", type: "string" }],
    type: "function",
  },
  {
    constant: true,
    inputs: [],
    name: "name",
    outputs: [{ name: "", type: "string" }],
    type: "function",
  },
  {
    constant: false,
    inputs: [
      { name: "_spender", type: "address" },
      { name: "_value", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ name: "", type: "bool" }],
    type: "function",
  },
  {
    constant: true,
    inputs: [
      { name: "_owner", type: "address" },
      { name: "_spender", type: "address" },
    ],
    name: "allowance",
    outputs: [{ name: "", type: "uint256" }],
    type: "function",
  },
] as const;

// Wagmi config
export const config = getDefaultConfig({
  appName: "BRIDGE 2026",
  projectId: process.env.NEXT_PUBLIC_WALLET_CONNECT_ID || "demo",
  chains: [mainnet, sepolia],
  ssr: true,
});

// API Base URL - empty string means same origin (for nginx proxy)
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "";
