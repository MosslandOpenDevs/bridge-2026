"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, X } from "lucide-react";
import { openExperimentalNotice } from "@/components/ExperimentalWarningModal";

// Per-browser convenience only: forgetting it just shows the banner again.
const DISMISS_KEY = "oracle.experimentalBanner.dismissed";

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    // Private mode or blocked storage: behave as if never dismissed.
    return false;
  }
}

function writeDismissed(): void {
  try {
    window.localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    // Dismissal then lasts for this page view only, which is still correct.
  }
}

/**
 * Experimental-service notice above the header.
 *
 * Not sticky on purpose. It used to be `sticky top-0 z-[60]` above the sticky
 * header (`top-0 z-50`): on a 375px phone the banner is ~84px tall, so once
 * the page scrolled it sat on top of the 65px header and hid the navigation.
 * Scrolling away with the page leaves the header the only sticky bar.
 *
 * The full notice is a dialog opened from "Details" instead of a modal that
 * blocked the first page view. The AI-content notice in the footer is the one
 * that must always stay visible; this banner may be dismissed, and the choice
 * is remembered.
 */
export function ExperimentalBanner() {
  const t = useTranslations("experimental");
  // Rendered by the server as visible; hidden after mount if dismissed before.
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setDismissed(readDismissed());
  }, []);

  if (dismissed) return null;

  const dismiss = () => {
    writeDismissed();
    setDismissed(true);
  };

  return (
    <div
      role="region"
      aria-label={t("banner.label")}
      className="bg-gradient-to-r from-amber-50 via-orange-50 to-red-50 border-b-2 border-amber-400"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-2 py-2 sm:py-3">
          <div className="flex items-center space-x-3 flex-1 min-w-0">
            <div className="flex-shrink-0">
              <AlertTriangle
                aria-hidden="true"
                className="w-5 h-5 sm:w-6 sm:h-6 text-amber-600"
              />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm sm:text-base font-semibold text-amber-900">
                {t("banner.title")}
              </p>
              <p className="text-xs sm:text-sm text-amber-800 mt-0.5 line-clamp-1">
                {t("banner.subtitle")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={(e) => openExperimentalNotice(e.currentTarget)}
            aria-haspopup="dialog"
            className="flex-shrink-0 px-2 py-1 rounded-lg text-xs sm:text-sm font-medium text-amber-900 underline underline-offset-2 hover:bg-amber-100 transition-colors"
          >
            {t("banner.details")}
          </button>
          <button
            type="button"
            onClick={dismiss}
            className="flex-shrink-0 p-1.5 rounded-lg hover:bg-amber-100 transition-colors"
            aria-label={t("banner.dismiss")}
          >
            <X aria-hidden="true" className="w-4 h-4 sm:w-5 sm:h-5 text-amber-700" />
          </button>
        </div>
      </div>
    </div>
  );
}
