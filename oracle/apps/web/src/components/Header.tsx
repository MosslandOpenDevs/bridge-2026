"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { RealtimeIndicator } from "./RealtimeIndicator";
import {
  Activity,
  AlertTriangle,
  Vote,
  Users,
  BarChart3,
  Home,
  Menu,
  X,
} from "lucide-react";

const navigationKeys = [
  { key: "dashboard", href: "/", icon: Home },
  { key: "signals", href: "/signals", icon: Activity },
  { key: "issues", href: "/issues", icon: AlertTriangle },
  { key: "proposals", href: "/proposals", icon: Vote },
  { key: "delegation", href: "/delegation", icon: Users },
  { key: "outcomes", href: "/outcomes", icon: BarChart3 },
] as const;

export function Header() {
  const pathname = usePathname();
  const t = useTranslations("nav");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Mobile menu button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2 rounded-lg text-gray-600 hover:bg-gray-100"
          >
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>

          {/* Logo */}
          <div className="flex items-center">
            <Link href="/" className="flex items-center space-x-2">
              <div className="w-8 h-8 bg-moss-600 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-lg">B</span>
              </div>
              <span className="font-bold text-xl text-gray-900 hidden sm:block">BRIDGE</span>
            </Link>
          </div>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center space-x-1">
            {navigationKeys.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  className={cn(
                    "flex items-center space-x-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                    isActive
                      ? "bg-moss-50 text-moss-700"
                      : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
                  )}
                >
                  <Icon className="w-4 h-4" />
                  <span>{t(item.key)}</span>
                </Link>
              );
            })}
          </nav>

          {/* Wallet, Realtime & Language */}
          <div className="flex items-center space-x-2 sm:space-x-3">
            <RealtimeIndicator />
            <div className="hidden sm:block">
              <LanguageSwitcher />
            </div>
            <ConnectButton
              showBalance={false}
              chainStatus="none"
              accountStatus={{ smallScreen: "avatar", largeScreen: "full" }}
            />
          </div>
        </div>
      </div>

      {/* Mobile Navigation Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-gray-200 bg-white">
          <nav className="px-4 py-3 space-y-1">
            {navigationKeys.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={cn(
                    "flex items-center space-x-3 px-3 py-3 rounded-lg text-base font-medium transition-colors",
                    isActive
                      ? "bg-moss-50 text-moss-700"
                      : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
                  )}
                >
                  <Icon className="w-5 h-5" />
                  <span>{t(item.key)}</span>
                </Link>
              );
            })}
          </nav>
          <div className="px-4 py-3 border-t border-gray-100">
            <LanguageSwitcher />
          </div>
        </div>
      )}
    </header>
  );
}
