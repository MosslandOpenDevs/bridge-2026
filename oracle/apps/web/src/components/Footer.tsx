"use client";

import { useTranslations } from "next-intl";
import { Twitter, BookOpen, Github, Mail, Globe } from "lucide-react";

// Sister sites in the Mossland AI-governance family. Order and wording are
// shared across bridge / algora / ao so the three sites read as one set.
const ECOSYSTEM = [
  { name: "BRIDGE", roleKey: "bridgeRole", href: "https://bridge.moss.land", current: true },
  { name: "Algora", roleKey: "algoraRole", href: "https://algora.moss.land", current: false },
  { name: "MOSS.AO", roleKey: "aoRole", href: "https://ao.moss.land", current: false },
] as const;

export function Footer() {
  const t = useTranslations("footer");
  return (
    <footer className="bg-white border-t border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Ecosystem wayfinding — identical content on every sister site */}
        <div className="pb-4 mb-4 border-b border-gray-100 text-center md:text-left">
          <p className="text-[10px] uppercase tracking-[0.22em] text-gray-400">
            {t("ecosystemLabel")}
          </p>
          <ul className="mt-2 flex flex-wrap justify-center md:justify-start gap-x-6 gap-y-1.5">
            {ECOSYSTEM.map((s) => (
              <li key={s.name} className="text-xs">
                {s.current ? (
                  <span aria-current="page" className="font-semibold text-gray-900">
                    <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-moss-600 align-middle" />
                    {s.name}
                    <span className="ml-1.5 font-normal text-gray-400">{t(s.roleKey)}</span>
                  </span>
                ) : (
                  <a
                    href={s.href}
                    target="_blank"
                    rel="noopener"
                    className="font-medium text-gray-500 hover:text-moss-600 transition-colors"
                  >
                    {s.name}
                    <span className="ml-1.5 font-normal text-gray-400">{t(s.roleKey)}</span>
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          {/* Brand */}
          <div className="text-center md:text-left">
            <p className="text-sm font-medium text-gray-900">MOSSLAND</p>
            <p className="text-xs text-gray-500 mt-1">
              We are building the Invisible Bridge.
            </p>
          </div>

          {/* Social Links */}
          <div className="flex items-center justify-center gap-3">
            <a
              href="https://moss.land"
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 text-gray-400 hover:text-moss-600 transition-colors"
              aria-label="Website"
            >
              <Globe className="w-4 h-4" />
            </a>
            <a
              href="https://x.com/TheMossland"
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 text-gray-400 hover:text-moss-600 transition-colors"
              aria-label="Twitter"
            >
              <Twitter className="w-4 h-4" />
            </a>
            <a
              href="https://medium.com/mossland-blog"
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 text-gray-400 hover:text-moss-600 transition-colors"
              aria-label="Medium"
            >
              <BookOpen className="w-4 h-4" />
            </a>
            <a
              href="https://github.com/mossland"
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 text-gray-400 hover:text-moss-600 transition-colors"
              aria-label="GitHub"
            >
              <Github className="w-4 h-4" />
            </a>
            <a
              href="mailto:contact@moss.land"
              className="p-1.5 text-gray-400 hover:text-moss-600 transition-colors"
              aria-label="Email"
            >
              <Mail className="w-4 h-4" />
            </a>
          </div>

          {/* Copyright */}
          <p className="text-xs text-gray-400 text-center md:text-right">
            &copy; 2025, 2026 MOSSLAND
          </p>
        </div>
      </div>
    </footer>
  );
}
