"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, X } from "lucide-react";

/*
 * The notice used to open by itself, full screen, on a visitor's first page
 * view: before any content, it asked people to accept terms they had not come
 * for. It now opens only when asked for — the experimental banner's "Details"
 * button — so the site's content is the first thing anyone sees.
 *
 * The dialog stays mounted once in the root layout; triggers anywhere open it
 * through this tiny store rather than each carrying their own copy.
 */
type Listener = (trigger: HTMLElement | null) => void;
const listeners = new Set<Listener>();

/** Open the notice; focus goes back to `trigger` (or whatever had focus) on close. */
export function openExperimentalNotice(trigger?: HTMLElement | null): void {
  listeners.forEach((l) => l(trigger ?? null));
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ExperimentalWarningModal() {
  const t = useTranslations("experimental");
  const [isOpen, setIsOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // Whatever had focus when the dialog opened — normally the trigger button —
  // so closing hands focus back instead of dropping it on <body>.
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const listener: Listener = (trigger) => {
      // Safari does not focus a button on click, so prefer the element the
      // caller names over document.activeElement.
      returnFocusRef.current =
        trigger ??
        (document.activeElement instanceof HTMLElement ? document.activeElement : null);
      setIsOpen(true);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    returnFocusRef.current?.focus();
    returnFocusRef.current = null;
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    closeRef.current?.focus();

    // The page behind an aria-modal dialog should not scroll under it.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      // Keep Tab cycling inside the dialog while it is open.
      if (e.key === "Tab" && dialogRef.current) {
        const focusable = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen, close]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-4 rounded-t-xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <AlertTriangle aria-hidden="true" className="w-6 h-6 text-white" />
              <h2 id={titleId} className="text-xl font-bold text-white">
                {t("modal.title")}
              </h2>
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={close}
              aria-label={t("modal.close")}
              className="p-1.5 rounded-lg hover:bg-white/20 transition-colors"
            >
              <X aria-hidden="true" className="w-5 h-5 text-white" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          <div className="bg-amber-50 border-l-4 border-amber-500 p-4 rounded">
            <p id={descriptionId} className="text-sm text-amber-900 font-medium">
              {t("modal.intro")}
            </p>
          </div>

          <div className="space-y-3">
            <WarningItem
              icon="⚠️"
              title={t("modal.warnings.service.title")}
              description={t("modal.warnings.service.description")}
            />
            <WarningItem
              icon="🗑️"
              title={t("modal.warnings.data.title")}
              description={t("modal.warnings.data.description")}
            />
            <WarningItem
              icon="⚖️"
              title={t("modal.warnings.governance.title")}
              description={t("modal.warnings.governance.description")}
            />
            <WarningItem
              icon="📋"
              title={t("modal.warnings.decisions.title")}
              description={t("modal.warnings.decisions.description")}
            />
          </div>

          <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
            <p className="text-xs text-gray-600">{t("modal.footer")}</p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 rounded-b-xl">
          <button
            type="button"
            onClick={close}
            className="w-full bg-amber-600 hover:bg-amber-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
          >
            {t("modal.accept")}
          </button>
        </div>
      </div>
    </div>
  );
}

function WarningItem({
  icon,
  title,
  description,
}: {
  icon: string;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start space-x-3">
      <span aria-hidden="true" className="text-2xl flex-shrink-0">
        {icon}
      </span>
      <div>
        <h3 className="font-semibold text-gray-900 mb-1">{title}</h3>
        <p className="text-sm text-gray-600">{description}</p>
      </div>
    </div>
  );
}
