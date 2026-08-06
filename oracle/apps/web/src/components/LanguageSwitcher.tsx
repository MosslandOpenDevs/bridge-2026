"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { Globe } from "lucide-react";
import { cn } from "@/lib/utils";
import { Locale, locales } from "@/i18n/config";
import { setLocale } from "@/lib/locale";

const localeNames: Record<Locale, string> = {
  en: "EN",
  ko: "KO",
};

export function LanguageSwitcher() {
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleLocaleChange = (newLocale: Locale) => {
    if (newLocale === locale) return;

    startTransition(async () => {
      await setLocale(newLocale);
      router.refresh();
    });
  };

  return (
    <div className="flex items-center space-x-1 bg-gray-100 rounded-lg p-1">
      <Globe className="w-4 h-4 text-gray-500 ml-1" />
      {locales.map((loc) => (
        <button
          key={loc}
          onClick={() => handleLocaleChange(loc)}
          disabled={isPending}
          className={cn(
            "px-2 py-1 text-xs font-medium rounded transition-colors",
            locale === loc
              ? "bg-white text-moss-700 shadow-sm"
              : "text-gray-600 hover:text-gray-900",
            isPending && "opacity-50 cursor-not-allowed"
          )}
        >
          {localeNames[loc]}
        </button>
      ))}
    </div>
  );
}
