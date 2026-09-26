"use client";

import { useTranslations } from "next-intl";
import { Bot } from "lucide-react";

// Mossland AI content labelling policy v1.0, in force since 2026-09-17. It
// names BRIDGE among the services whose automatic output must carry a notice
// users can see (§4), and fixes the wording, which is why the first sentence
// in messages is the policy's text verbatim and should not be paraphrased.
// The Korean text governs where the two differ.
const POLICY_URL =
  "https://github.com/mossland/Disclosure-and-Materials/blob/main/disclosures/2026/2026-09-16_ai-content-labelling-policy.md";

/**
 * Persistent AI-content notice for every page.
 *
 * Deliberately not dismissible and not a modal: the policy asks for a notice
 * people can find at any time, not a hurdle they click through once. The
 * experimental banner above the header can be closed, so it cannot carry this.
 */
export function AiContentNotice() {
  const t = useTranslations("footer");
  return (
    <div role="note" className="bg-gray-50 border-t border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-start gap-2 text-xs text-gray-600">
        <Bot aria-hidden="true" className="w-4 h-4 mt-px flex-shrink-0 text-gray-500" />
        <p>
          {t("aiNotice")} {t("aiNoticeScope")}{" "}
          <a
            href={POLICY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-moss-600 transition-colors"
          >
            {t("aiNoticePolicy")}
            <span aria-hidden="true" className="ml-0.5">
              ↗
            </span>
            <span className="sr-only">{` (${t("newTab")})`}</span>
          </a>
        </p>
      </div>
    </div>
  );
}
