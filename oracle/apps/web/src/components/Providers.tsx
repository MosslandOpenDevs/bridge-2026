"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { RainbowKitProvider } from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";
import { config } from "@/lib/config";
import { SocketProvider } from "@/contexts/SocketContext";
import { ToastProvider } from "@/contexts/ToastContext";
import { WebSocketToastHandler } from "@/components/WebSocketToastHandler";

const queryClient = new QueryClient();

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          <SocketProvider>
            <ToastProvider position="top-right" maxToasts={5}>
              <WebSocketToastHandler />
              {children}
            </ToastProvider>
          </SocketProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
