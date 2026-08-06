// Baseline security headers applied to every response. CSP is intentionally
// omitted here — a wallet dApp (RainbowKit / WalletConnect) needs a carefully
// tuned policy that is better managed at the edge/proxy once tested.
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=()',
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@bridge-2026/shared'],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
      // The wagmi/RainbowKit connector chain pulls in @coinbase/cdp-sdk, whose
      // x402 payment signing lazily imports the @x402/* packages. Those are
      // declared optional peer dependencies and are therefore never installed;
      // webpack still resolves the dynamic import statically and fails the
      // build. This app only reads governance state and casts votes — it never
      // signs an x402 payment — so the branch is unreachable here. Drop these
      // entries if x402 payments are ever added, and install the peers instead.
      '@x402/core': false,
      '@x402/evm': false,
      '@x402/svm': false,
      '@x402/extensions': false,
    };
    return config;
  },
};

module.exports = nextConfig;









