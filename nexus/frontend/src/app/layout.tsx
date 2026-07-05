import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';

const inter = Inter({ subsets: ['latin'] });

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://bridge.moss.land';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'BRIDGE 2026 — Moss Coin Holder DAO',
    template: '%s · BRIDGE 2026',
  },
  description:
    'Physical AI Expansion. Where agents propose, people decide, reality updates — the Moss Coin holder interface for BRIDGE 2026 governance.',
  applicationName: 'BRIDGE 2026',
  keywords: [
    'BRIDGE 2026',
    'Mossland',
    'Physical AI',
    'AI governance',
    'DAO',
    'Moss Coin',
    'on-chain governance',
  ],
  authors: [{ name: 'Mossland', url: 'https://moss.land' }],
  creator: 'Mossland',
  publisher: 'Mossland',
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    url: SITE_URL,
    siteName: 'BRIDGE 2026',
    title: 'BRIDGE 2026 — Moss Coin Holder DAO',
    description:
      'Physical AI Expansion. Where agents propose, people decide, reality updates.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'BRIDGE 2026 — Moss Coin Holder DAO',
    description:
      'Physical AI Expansion. Where agents propose, people decide, reality updates.',
    creator: '@TheMossland',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
  },
};

export const viewport: Viewport = {
  themeColor: '#16a34a',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}









