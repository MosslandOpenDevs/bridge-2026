const createNextIntlPlugin = require('next-intl/plugin');

const withNextIntl = createNextIntlPlugin('./src/i18n.ts');

// NEXT_PUBLIC_VOTING_ENABLED is inlined into the bundles, and every page that
// reads it (src/lib/voting.ts) renders on demand, so a bad value would only
// surface as a runtime error on those pages. Refuse it here instead, where
// `next build` fails before anything is swapped in. Same accepted values as
// src/lib/voting.ts and the API's envFlag; Next has loaded .env* by now.
{
  const raw = process.env.NEXT_PUBLIC_VOTING_ENABLED;
  const value = (raw ?? "").trim().toLowerCase();
  if (raw !== undefined && raw !== "" &&
      !["1", "true", "yes", "on", "0", "false", "no", "off"].includes(value)) {
    throw new Error(
      `NEXT_PUBLIC_VOTING_ENABLED must be a boolean (1/0, true/false, yes/no, on/off), got "${raw}"`,
    );
  }
}

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
  experimental: {
    // Runs src/instrumentation.ts before any route module: it strips Node 25's
    // method-less localStorage global, which otherwise breaks wallet libraries
    // during SSR and turns every page into a 500.
    instrumentationHook: true,
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

module.exports = withNextIntl(nextConfig);
