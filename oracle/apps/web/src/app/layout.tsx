import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getLocale } from "next-intl/server";
import { Providers } from "@/components/Providers";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { AiContentNotice } from "@/components/AiContentNotice";
import { ExperimentalBanner } from "@/components/ExperimentalBanner";
import { ExperimentalWarningModal } from "@/components/ExperimentalWarningModal";
import { NpcCityStrip } from "@/components/NpcCityStrip";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

// Force dynamic rendering for all pages (wagmi/RainbowKit need client-side rendering)
export const dynamic = "force-dynamic";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL || "https://bridge.moss.land";

// What the site is today, not what it was pitched as. The old copy promised a
// "Physical AI Governance OS" where "people decide" and outcomes are "proved
// on-chain"; in practice no vote has ever been recorded, no outcome proof
// exists, and BRIDGE is a Lab service (MIP-1) whose output binds no one —
// MossDAO decides on Agora. Search results and link previews are where most
// people first meet the site, so this is where an overclaim does most harm.
const TITLE = "BRIDGE 2026 — Reality-signal governance lab · Mossland";
const DESCRIPTION =
  "An experimental Mossland Lab service. BRIDGE 2026 collects reality signals, detects issues and has AI agents draft governance proposals. Its outputs are non-binding; MossDAO's official decisions are made on Agora.";
const SHARE_DESCRIPTION =
  "An experimental Mossland Lab service that turns reality signals into non-binding, AI-drafted governance proposals.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: "%s · BRIDGE 2026",
  },
  description: DESCRIPTION,
  applicationName: "BRIDGE 2026",
  keywords: [
    "BRIDGE 2026",
    "Mossland",
    "AI governance",
    "governance lab",
    "DAO",
    "Reality Oracle",
    "AI agents",
    "Moss Coin",
  ],
  authors: [{ name: "Mossland", url: "https://moss.land" }],
  creator: "Mossland",
  publisher: "Mossland",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: "Mossland",
    title: TITLE,
    description: SHARE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: SHARE_DESCRIPTION,
    creator: "@TheMossland",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
    },
  },
};

export const viewport: Viewport = {
  themeColor: "#16a34a",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const messages = await getMessages();
  const locale = await getLocale();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className={inter.className}>
        <NextIntlClientProvider messages={messages}>
          <Providers>
            <div className="min-h-screen bg-gray-50 flex flex-col">
              <ExperimentalBanner />
              <ExperimentalWarningModal />
              <Header />
              <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-1">
                {children}
              </main>
              {/* NPC city cross-link — read-side fetch with 10-min
                  revalidate; renders nothing if npc.moss.land is down. */}
              <NpcCityStrip />
              {/* Below the NPC strip on purpose: those headlines are AI
                  output too, and the notice should cover everything above. */}
              <AiContentNotice />
              <Footer />
            </div>
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
