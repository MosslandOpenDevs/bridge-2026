"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { KeyRound, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { getAdminKey, setAdminKey, subscribeAdminKey } from "@/lib/adminKey";

/**
 * Lets an operator supply the admin API key for this tab. Actions such as
 * collecting signals, deliberating, or creating and executing proposals are
 * authenticated with it; without one the API answers 401/503.
 */
export function AdminKeyButton() {
  const t = useTranslations("admin");
  const [open, setOpen] = useState(false);
  const [stored, setStored] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  // sessionStorage is unavailable during SSR, so read it after mount.
  useEffect(() => {
    setStored(getAdminKey());
    return subscribeAdminKey(setStored);
  }, []);

  const connected = Boolean(stored);

  const save = () => {
    setAdminKey(draft);
    setDraft("");
    setOpen(false);
  };

  const clear = () => {
    setAdminKey(null);
    setDraft("");
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={connected ? t("active") : t("inactive")}
        aria-label={connected ? t("active") : t("inactive")}
        className={cn(
          "flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium border transition-colors",
          connected
            ? "border-moss-200 bg-moss-50 text-moss-700 hover:bg-moss-100"
            : "border-gray-200 text-gray-500 hover:bg-gray-50",
        )}
      >
        <KeyRound className="w-4 h-4" />
        <span className="hidden lg:inline">
          {connected ? t("active") : t("inactive")}
        </span>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-w-[90vw] bg-white border border-gray-200 rounded-lg shadow-lg p-4 z-50">
          <div className="flex items-start justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-900">{t("title")}</h3>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-gray-400 hover:text-gray-600"
              aria-label={t("close")}
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <p className="text-xs text-gray-500 mb-3">{t("description")}</p>

          <input
            type="password"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
            }}
            placeholder={connected ? t("storedPlaceholder") : t("placeholder")}
            autoComplete="off"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3"
          />

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={!draft.trim()}
              className="btn-primary text-sm px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {t("save")}
            </button>
            {connected && (
              <button
                type="button"
                onClick={clear}
                className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50"
              >
                {t("clear")}
              </button>
            )}
          </div>

          <p className="text-[11px] text-gray-400 mt-3">{t("scopeNote")}</p>
        </div>
      )}
    </div>
  );
}
