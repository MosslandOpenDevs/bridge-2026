import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { mainnet, sepolia, goerli } from 'wagmi/chains';

// Contract addresses live in `@/config/contracts` only. A second copy here had
// drifted to a 35-character string, which is not a valid 20-byte address.

export const config = getDefaultConfig({
  appName: 'BRIDGE 2026 — Moss Coin DAO',
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'your-project-id',
  chains: [mainnet, sepolia, goerli],
  ssr: true,
});









