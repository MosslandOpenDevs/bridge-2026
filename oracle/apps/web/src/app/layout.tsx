import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getLocale } from "next-intl/server";
import { Providers } from "@/components/Providers";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { ExperimentalBanner } from "@/components/ExperimentalBanner";
import { ExperimentalWarningModal } from "@/components/ExperimentalWarningModal";
import { NpcCityStrip } from "@/components/NpcCityStrip";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

// Force dynamic rendering for all pages (wagmi/RainbowKit need client-side rendering)
export const dynamic = "force-dynamic";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL || "https://bridge.moss.land";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "BRIDGE 2026 — Physical AI Governance OS",
    template: "%s · BRIDGE 2026",
  },
  description:
    "Where agents propose, people decide, reality updates. BRIDGE 2026 turns reality signals into proposals, has AI agents reach consensus, keeps humans as the final decision-makers, and proves outcomes on-chain.",
  applicationName: "BRIDGE 2026",
  keywords: [
    "BRIDGE 2026",
    "Mossland",
    "Physical AI",
    "AI governance",
    "DAO",
    "Reality Oracle",
    "Agentic Consensus",
    "Moss Coin",
    "on-chain governance",
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
    siteName: "BRIDGE 2026",
    title: "BRIDGE 2026 — Physical AI Governance OS",
    description:
      "Where agents propose, people decide, reality updates. Mossland's reality-driven governance system.",
  },
  twitter: {
    card: "summary_large_image",
    title: "BRIDGE 2026 — Physical AI Governance OS",
    description:
      "Where agents propose, people decide, reality updates. Mossland's reality-driven governance system.",
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
              <Footer />
            </div>
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
