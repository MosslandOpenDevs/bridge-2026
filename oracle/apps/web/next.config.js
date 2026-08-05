const createNextIntlPlugin = require('next-intl/plugin');

const withNextIntl = createNextIntlPlugin('./src/i18n.ts');

// Baseline security headers applied to every response. CSP is intentionally
// omitted here — a wallet dApp (RainbowKit / WalletConnect) needs a carefully
// tuned policy that is better managed at the edge/proxy once tested.
const securityHeaders = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@oracle/core"],
  // deploy.sh builds into a throwaway dir (NEXT_DIST_DIR=.next.new) and swaps
  // it over the live .next only after `next build` succeeds -- `next build`
  // empties its output dir at start, so building straight into .next would
  // take the running site's assets down for the whole build (and leave it
  // broken if the build fails). Unset (dev, plain builds) means default.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

module.exports = withNextIntl(nextConfig);
