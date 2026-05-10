import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
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

export const metadata: Metadata = {
  title: "BRIDGE - Physical AI Governance",
  description: "Where agents propose, people decide, reality updates.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const messages = await getMessages();

  return (
    <html lang="en" suppressHydrationWarning>
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
