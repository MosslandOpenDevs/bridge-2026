import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function formatNumber(num: number): string {
  return new Intl.NumberFormat().format(num);
}

export function formatMOC(value: bigint, decimals: number = 18): string {
  const divisor = BigInt(10 ** decimals);
  const integerPart = value / divisor;
  const fractionalPart = value % divisor;
  const fractionalStr = fractionalPart.toString().padStart(decimals, "0").slice(0, 2);
  return `${formatNumber(Number(integerPart))}.${fractionalStr} MOC`;
}

// Largest unit first; a span is shown in the first unit it fills at least once.
const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 60 * 60],
  ["month", 30 * 24 * 60 * 60],
  ["day", 24 * 60 * 60],
  ["hour", 60 * 60],
  ["minute", 60],
  ["second", 1],
];

function documentLocale(): string {
  // The root layout renders <html lang={locale}> from the same cookie
  // next-intl reads, so this is the active UI locale in the browser. It is a
  // fallback for callers that have not been handed the locale explicitly.
  if (typeof document !== "undefined" && document.documentElement.lang) {
    return document.documentElement.lang;
  }
  return "en";
}

/**
 * "3 days ago" / "3일 전", or "in 30 days" / "30일 후" for a future date, in the
 * given locale (pass next-intl's `useLocale()`).
 *
 * This used to build Korean strings by hand, so the English UI read "93일 전",
 * and it assumed every date was in the past, so a delegation expiring next
 * month rendered as "-2591999초 전".
 */
export function timeAgo(
  date: Date | string | number,
  locale: string = documentLocale(),
  now: number = Date.now(),
): string {
  const then = date instanceof Date ? date.getTime() : new Date(date).getTime();
  if (Number.isNaN(then)) return "";

  // Negative = past, which is what Intl.RelativeTimeFormat expects.
  const diffSeconds = (then - now) / 1000;
  const abs = Math.abs(diffSeconds);
  const [unit, size] =
    RELATIVE_UNITS.find(([, s]) => abs >= s) ?? RELATIVE_UNITS[RELATIVE_UNITS.length - 1];
  // Truncate toward zero so "59 minutes" never rounds up to "1 hour" early.
  const value = Math.trunc(diffSeconds / size);

  // numeric: "auto" turns 0 seconds into "now" and -1 day into "yesterday".
  return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(value, unit);
}

export function getSeverityColor(severity: string): string {
  switch (severity) {
    case "critical":
      return "text-red-600 bg-red-50";
    case "high":
      return "text-orange-600 bg-orange-50";
    case "medium":
      return "text-yellow-600 bg-yellow-50";
    case "low":
      return "text-green-600 bg-green-50";
    default:
      return "text-gray-600 bg-gray-50";
  }
}

export function getStatusColor(status: string): string {
  switch (status) {
    case "active":
      return "text-blue-600 bg-blue-50";
    case "passed":
      return "text-green-600 bg-green-50";
    case "rejected":
      return "text-red-600 bg-red-50";
    case "executed":
      return "text-purple-600 bg-purple-50";
    case "pending":
      return "text-gray-600 bg-gray-50";
    default:
      return "text-gray-600 bg-gray-50";
  }
}
