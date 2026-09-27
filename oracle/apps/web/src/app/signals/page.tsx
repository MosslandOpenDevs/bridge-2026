"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useSocketContext } from "@/contexts/SocketContext";
import {
  Activity,
  RefreshCw,
  Filter,
  AlertTriangle,
  Zap,
  Server,
  Globe,
  Loader2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Hash,
  Clock,
  Layers,
  TrendingUp,
  Github,
  Twitter,
  FileText,
  Search,
  X,
  Bell,
  FlaskConical,
  Repeat,
} from "lucide-react";
import { cn, getSeverityColor, timeAgo } from "@/lib/utils";
import { api } from "@/lib/api";
import { useHasAdminKey } from "@/hooks/useAdminKey";

const sourceIcons: Record<string, React.ElementType> = {
  onchain: Zap,
  telemetry: Server,
  api: Globe,
};

/** One feed row: a signal plus the identical observations folded into it. */
interface SignalRow {
  /**
   * React key. Must not be an observation id: collectors append an identical
   * observation every minute and the 500-row window slides, so both the newest
   * and the oldest id of a run change on each refetch, which remounted the card
   * and snapped an expanded detail panel shut.
   */
  key: string;
  signal: any; // the newest observation, shown on the card
  count: number;
  firstAt: string;
  lastAt: string;
}

function observationFingerprint(s: any): string {
  return JSON.stringify([
    s.category ?? "",
    s.description,
    s.value,
    s.unit,
    s.severity,
    s.source,
    Boolean(s.synthetic),
  ]);
}

/**
 * Collectors poll every minute and record a row whether or not anything
 * changed, so ~99% of observations repeat the previous one (github_commit had
 * 1 distinct value in 10,078 rows over 7 days). Shown raw, the feed was seven
 * messages repeated ~71 times each. Fold each run of identical observations
 * within a category into one row. "Consecutive" is per category: the
 * collectors interleave, so the minute-by-minute list alternates categories.
 * A change in value starts a new row, so real movements stay visible.
 */
function collapseRepeats(signals: any[]): SignalRow[] {
  const rows: SignalRow[] = [];
  const openRowByCategory = new Map<string, { row: SignalRow; fingerprint: string }>();
  // Runs seen so far per fingerprint, counted from the top (newest) of the
  // list, so an A,B,A sequence in one category still gets distinct keys. A new
  // repeat joins the top run and leaves every ordinal as it was.
  const runsByFingerprint = new Map<string, number>();
  for (const signal of signals) {
    const category = signal.category ?? "";
    const fingerprint = observationFingerprint(signal);
    const entry = openRowByCategory.get(category);
    const open = entry && entry.fingerprint === fingerprint ? entry.row : undefined;
    if (open) {
      open.count += 1;
      if (signal.timestamp < open.firstAt) open.firstAt = signal.timestamp;
      if (signal.timestamp > open.lastAt) open.lastAt = signal.timestamp;
      continue;
    }
    const ordinal = runsByFingerprint.get(fingerprint) ?? 0;
    runsByFingerprint.set(fingerprint, ordinal + 1);
    const row = {
      key: `${fingerprint}#${ordinal}`,
      signal,
      count: 1,
      firstAt: signal.timestamp,
      lastAt: signal.timestamp,
    };
    rows.push(row);
    openRowByCategory.set(category, { row, fingerprint });
  }
  return rows;
}

function formatRange(first: string, last: string, locale: string): string {
  const a = new Date(first);
  const b = new Date(last);
  const sameDay = a.toDateString() === b.toDateString();
  const time = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" });
  const dateTime = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return sameDay
    ? `${time.format(a)}–${time.format(b)}`
    : `${dateTime.format(a)}–${dateTime.format(b)}`;
}

function SignalCard({ row, t, locale }: { row: SignalRow; t: any; locale: string }) {
  const { signal } = row;
  const [isExpanded, setIsExpanded] = useState(false);

  const SourceIcon = sourceIcons[signal.source] || Activity;

  const categoryIcons: Record<string, React.ElementType> = {
    github_commit: Github,
    github_push: Github,
    github_release: Github,
    github_overview: Github,
    github_activity: Github,
    medium_post: FileText,
    medium_activity: FileText,
    twitter_tweet: Twitter,
    twitter_profile: Twitter,
    twitter_engagement: Twitter,
    moc_transfer: Zap,
    foundation_transfer: Zap,
    moc_price: TrendingUp,
    moc_price_alert: TrendingUp,
    network_gas: Layers,
  };

  const CategoryIcon = categoryIcons[signal.category] || Activity;
  const metadata = signal.metadata || {};

  const getExternalLink = (): { url: string; label: string } | null => {
    if (metadata.txHash) {
      return {
        url: `https://etherscan.io/tx/${metadata.txHash}`,
        label: "Etherscan",
      };
    }
    if (metadata.apiEndpoint?.includes("github.com")) {
      return { url: metadata.apiEndpoint, label: "GitHub" };
    }
    if (metadata.apiEndpoint?.includes("twitter.com")) {
      return { url: metadata.apiEndpoint, label: "Twitter" };
    }
    if (metadata.apiEndpoint?.includes("medium.com")) {
      return { url: metadata.apiEndpoint, label: "Medium" };
    }
    if (signal.category?.includes("github")) {
      return { url: "https://github.com/mossland", label: "GitHub" };
    }
    if (signal.category?.includes("medium")) {
      return { url: "https://medium.com/mossland-blog", label: "Medium" };
    }
    return null;
  };

  const externalLink = getExternalLink();

  const sourceLabels: Record<string, string> = {
    onchain: t("signals.onchain"),
    telemetry: t("signals.telemetry"),
    api: t("signals.api"),
  };

  return (
    <div
      className={cn(
        "p-3 sm:p-4 bg-gray-50 rounded-lg transition-all border-l-4",
        signal.severity === "critical"
          ? "border-red-500"
          : signal.severity === "high"
            ? "border-orange-500"
            : signal.severity === "medium"
              ? "border-yellow-500"
              : "border-green-500"
      )}
    >
      <div className="flex items-start space-x-3 sm:space-x-4">
        <div
          className={cn(
            "p-2 rounded-lg flex-shrink-0 hidden sm:block",
            signal.severity === "critical"
              ? "bg-red-100"
              : signal.severity === "high"
                ? "bg-orange-100"
                : signal.severity === "medium"
                  ? "bg-yellow-100"
                  : "bg-green-100"
          )}
        >
          <SourceIcon
            className={cn(
              "w-5 h-5",
              signal.severity === "critical"
                ? "text-red-600"
                : signal.severity === "high"
                  ? "text-orange-600"
                  : signal.severity === "medium"
                    ? "text-yellow-600"
                    : "text-green-600"
            )}
          />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center flex-wrap gap-1 sm:gap-2">
            <span className={cn("badge text-xs", getSeverityColor(signal.severity))}>
              {t(`signals.severityLevels.${signal.severity}`)}
            </span>
            <span className="badge bg-gray-100 text-gray-600 text-xs">
              {sourceLabels[signal.source] || signal.source}
            </span>
            <span className="badge bg-blue-50 text-blue-600 flex items-center gap-1 text-xs">
              <CategoryIcon className="w-3 h-3" />
              <span className="hidden sm:inline">{signal.category?.replace(/_/g, " ") || t("signals.unknownCategory")}</span>
              <span className="sm:hidden">{(signal.category?.split("_")[0]) || t("signals.unknownCategory")}</span>
            </span>
            {signal.synthetic && (
              <span
                className="badge bg-amber-100 text-amber-800 flex items-center gap-1 text-xs"
                title={t("common.syntheticHint")}
              >
                <FlaskConical className="w-3 h-3" aria-hidden="true" />
                {t("common.synthetic")}
              </span>
            )}
          </div>

          {/* overflow-wrap:anywhere (not break-words) so a long unbroken token such
              as a GitHub branch name also lowers the min-content width; otherwise
              it widened the whole page to 414px on a 375px screen. */}
          <p className="mt-2 text-sm sm:text-base text-gray-900 font-medium line-clamp-2 [overflow-wrap:anywhere]">
            {signal.description || `${t("signals.value")}: ${signal.value}`}
          </p>

          {signal.value !== undefined && signal.unit && (
            <div className="mt-2 flex items-baseline gap-1">
              <span className="text-xl sm:text-2xl font-bold text-moss-700">
                {typeof signal.value === "number"
                  ? signal.value.toLocaleString(undefined, {
                      maximumFractionDigits: 2,
                    })
                  : signal.value}
              </span>
              <span className="text-xs sm:text-sm text-gray-500">{signal.unit}</span>
            </div>
          )}

          <div className="mt-2 flex items-center flex-wrap gap-x-2 gap-y-1 sm:gap-x-4 text-xs sm:text-sm text-gray-500">
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" aria-hidden="true" />
              {timeAgo(signal.timestamp, locale)}
            </span>
            {row.count > 1 && (
              <span
                className="flex items-center gap-1 text-gray-600"
                title={t("signals.repeatedHint", { count: row.count })}
              >
                <Repeat className="w-3 h-3" aria-hidden="true" />
                {t("signals.repeated", {
                  count: row.count,
                  range: formatRange(row.firstAt, row.lastAt, locale),
                })}
              </span>
            )}
            {metadata.blockNumber && (
              <span className="flex items-center gap-1">
                <Layers className="w-3 h-3" />
                <span className="hidden sm:inline">{t("signals.blockPrefix")}</span>{metadata.blockNumber.toLocaleString()}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-end sm:items-center gap-2 flex-shrink-0">
          {(signal.severity === "critical" || signal.severity === "high") && (
            <button className="btn-secondary text-xs sm:text-sm flex items-center space-x-1 py-1 px-2 sm:py-2 sm:px-4">
              <AlertTriangle className="w-3 h-3 sm:w-4 sm:h-4" />
              <span className="hidden sm:inline">{t("issues.createProposal")}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            aria-expanded={isExpanded}
            aria-label={isExpanded ? t("signals.hideDetails") : t("signals.showDetails")}
            className="p-2 hover:bg-gray-200 rounded-md transition-colors"
          >
            {isExpanded ? (
              <ChevronUp className="w-5 h-5 text-gray-500" />
            ) : (
              <ChevronDown className="w-5 h-5 text-gray-500" />
            )}
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="mt-4 pt-4 border-t border-gray-200">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <span className="text-xs font-medium text-gray-500 uppercase">
                {t("signals.fields.signalId")}
              </span>
              <p className="mt-1 text-sm font-mono text-gray-700 truncate">
                {signal.id}
              </p>
            </div>

            {signal.originalId && (
              <div>
                <span className="text-xs font-medium text-gray-500 uppercase">
                  {t("signals.fields.originalId")}
                </span>
                <p className="mt-1 text-sm font-mono text-gray-700 truncate">
                  {signal.originalId}
                </p>
              </div>
            )}

            {metadata.txHash && (
              <div>
                <span className="text-xs font-medium text-gray-500 uppercase flex items-center gap-1">
                  <Hash className="w-3 h-3" />
                  {t("signals.fields.txHash")}
                </span>
                <p className="mt-1 text-sm font-mono text-gray-700 truncate">
                  {metadata.txHash}
                </p>
              </div>
            )}

            {metadata.blockNumber && (
              <div>
                <span className="text-xs font-medium text-gray-500 uppercase flex items-center gap-1">
                  <Layers className="w-3 h-3" />
                  {t("signals.fields.blockNumber")}
                </span>
                <p className="mt-1 text-sm font-mono text-gray-700">
                  {metadata.blockNumber.toLocaleString()}
                </p>
              </div>
            )}

            {metadata.apiEndpoint && (
              <div className="md:col-span-2">
                <span className="text-xs font-medium text-gray-500 uppercase flex items-center gap-1">
                  <Globe className="w-3 h-3" />
                  {t("signals.fields.apiEndpoint")}
                </span>
                <p className="mt-1 text-sm font-mono text-gray-700 truncate">
                  {metadata.apiEndpoint}
                </p>
              </div>
            )}

            <div>
              <span className="text-xs font-medium text-gray-500 uppercase flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {t("signals.timestamp")}
              </span>
              <p className="mt-1 text-sm text-gray-700">
                {new Date(signal.timestamp).toLocaleString(locale)}
              </p>
            </div>

            {signal.rawData && (
              <div className="md:col-span-2">
                <span className="text-xs font-medium text-gray-500 uppercase">
                  {t("signals.fields.rawData")}
                </span>
                <pre className="mt-1 p-2 bg-gray-100 rounded text-xs font-mono text-gray-700 overflow-x-auto">
                  {JSON.stringify(signal.rawData, null, 2)}
                </pre>
              </div>
            )}
          </div>

          {externalLink && (
            <div className="mt-4">
              <a
                href={externalLink.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm text-moss-600 hover:text-moss-700 hover:underline"
              >
                <ExternalLink className="w-4 h-4" />
                {t("signals.viewSource")} ({externalLink.label})
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function SignalsPage() {
  const t = useTranslations();
  const locale = useLocale();
  const hasAdminKey = useHasAdminKey();
  const queryClient = useQueryClient();
  const { onSignalsCollected, isConnected } = useSocketContext();
  const [filter, setFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [realtimeNotification, setRealtimeNotification] = useState<{ count: number; show: boolean } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["signals"],
    queryFn: () => api.getSignals(),
    refetchInterval: isConnected ? 30000 : 10000, // Slower refresh when connected via WebSocket
  });

  // Listen for real-time signal updates
  useEffect(() => {
    const unsubscribe = onSignalsCollected((event) => {
      // Show notification
      setRealtimeNotification({ count: event.count, show: true });

      // Auto-hide after 3 seconds
      setTimeout(() => {
        setRealtimeNotification(null);
      }, 3000);

      // Invalidate query to refresh data
      queryClient.invalidateQueries({ queryKey: ["signals"] });
    });

    return () => unsubscribe();
  }, [onSignalsCollected, queryClient]);

  const collectMutation = useMutation({
    mutationFn: () => api.collectSignals(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["signals"] });
    },
  });

  const signals = data?.signals ?? [];

  // Extract unique categories
  const categories = Array.from(new Set(signals.map((s: any) => s.category).filter(Boolean))) as string[];

  const filteredSignals = signals.filter((s: any) => {
    const severityMatch = filter === "all" || s.severity === filter;
    const sourceMatch = sourceFilter === "all" || s.source === sourceFilter;
    const categoryMatch = categoryFilter === "all" || s.category === categoryFilter;
    const searchMatch = searchQuery === "" ||
      s.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.category?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.id?.toLowerCase().includes(searchQuery.toLowerCase());
    return severityMatch && sourceMatch && categoryMatch && searchMatch;
  });
  const rows = collapseRepeats(filteredSignals);

  const severityCounts = {
    critical: signals.filter((s: any) => s.severity === "critical").length,
    high: signals.filter((s: any) => s.severity === "high").length,
    medium: signals.filter((s: any) => s.severity === "medium").length,
    low: signals.filter((s: any) => s.severity === "low").length,
  };

  const sourceCounts = {
    onchain: signals.filter((s: any) => s.source === "onchain").length,
    api: signals.filter((s: any) => s.source === "api").length,
    telemetry: signals.filter((s: any) => s.source === "telemetry").length,
  };

  const sourceLabels: Record<string, string> = {
    onchain: t("signals.onchain"),
    telemetry: t("signals.telemetry"),
    api: t("signals.api"),
  };

  return (
    <div className="space-y-6">
      {/* Real-time Notification Toast */}
      {realtimeNotification?.show && (
        <div className="fixed top-20 right-4 z-50 bg-moss-500 text-white px-4 py-3 rounded-lg shadow-lg flex items-center space-x-2 animate-in fade-in slide-in-from-top-2">
          <Bell className="w-5 h-5" />
          <span className="font-medium">{t("signals.newCollected", { count: realtimeNotification.count })}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">{t("signals.title")}</h1>
          <p className="mt-1 text-sm sm:text-base text-gray-500">{t("signals.subtitle")}</p>
        </div>
        {/* Operator control: POST /api/signals/collect is admin-gated, so for
            everyone else it was a button that could only fail. Same key check
            as the issues page; the collector runs on its own schedule. */}
        {hasAdminKey && (
          <button
            onClick={() => collectMutation.mutate()}
            disabled={collectMutation.isPending}
            className="btn-primary flex items-center justify-center space-x-2 w-full sm:w-auto"
          >
            {collectMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            <span>{collectMutation.isPending ? t("signals.collecting") : t("signals.collect")}</span>
          </button>
        )}
      </div>

      {/* Severity Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Object.entries(severityCounts).map(([severity, count]) => (
          <button
            key={severity}
            onClick={() => setFilter(filter === severity ? "all" : severity)}
            className={cn(
              "card text-center transition-all",
              filter === severity && "ring-2 ring-moss-500"
            )}
          >
            <span className={cn("badge", getSeverityColor(severity))}>
              {t(`signals.severityLevels.${severity}`).toUpperCase()}
            </span>
            <p className="mt-2 text-2xl font-bold text-gray-900">{count}</p>
          </button>
        ))}
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Search className="w-5 h-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t("common.search") + "..."}
          className="w-full pl-10 pr-10 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-moss-500 focus:border-moss-500"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery("")}
            aria-label={t("signals.clearSearch")}
            className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Source Filter */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setSourceFilter("all")}
          className={cn(
            "badge cursor-pointer transition-all",
            sourceFilter === "all"
              ? "bg-moss-600 text-white"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          )}
        >
          {t("signals.allSources")} ({signals.length})
        </button>
        {Object.entries(sourceCounts).map(([source, count]) => {
          const Icon = sourceIcons[source] || Activity;
          return (
            <button
              key={source}
              onClick={() =>
                setSourceFilter(sourceFilter === source ? "all" : source)
              }
              className={cn(
                "badge cursor-pointer transition-all flex items-center gap-1",
                sourceFilter === source
                  ? "bg-moss-600 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              )}
            >
              <Icon className="w-3 h-3" />
              {sourceLabels[source]} ({count})
            </button>
          );
        })}
      </div>

      {/* Category Filter */}
      {categories.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <span className="text-sm text-gray-500 flex items-center mr-2">
            <Filter className="w-4 h-4 mr-1" />
            {t("signals.category")}:
          </span>
          <button
            onClick={() => setCategoryFilter("all")}
            className={cn(
              "badge cursor-pointer transition-all text-xs",
              categoryFilter === "all"
                ? "bg-blue-600 text-white"
                : "bg-blue-50 text-blue-600 hover:bg-blue-100"
            )}
          >
            {t("common.all")}
          </button>
          {categories.slice(0, 10).map((category) => (
            <button
              key={category}
              onClick={() => setCategoryFilter(categoryFilter === category ? "all" : category)}
              className={cn(
                "badge cursor-pointer transition-all text-xs",
                categoryFilter === category
                  ? "bg-blue-600 text-white"
                  : "bg-blue-50 text-blue-600 hover:bg-blue-100"
              )}
            >
              {category.replace(/_/g, " ")}
            </button>
          ))}
          {categories.length > 10 && (
            <span className="text-xs text-gray-400">{t("signals.moreCategories", { count: categories.length - 10 })}</span>
          )}
        </div>
      )}

      {/* Signals List */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 flex items-center">
              <Activity className="w-5 h-5 mr-2 text-moss-600" />
              {t("signals.title")}
              <span className="ml-2 text-sm font-normal text-gray-500">
                ({rows.length})
              </span>
            </h2>
            <p className="text-xs text-gray-400 mt-1">
              {t("signals.maxDisplayNote", { max: 500 })}
              {rows.length < filteredSignals.length &&
                ` · ${t("signals.collapsedNote", {
                  observations: filteredSignals.length,
                  rows: rows.length,
                })}`}
            </p>
          </div>
          <div className="flex items-center space-x-2">
            <Filter className="w-4 h-4 text-gray-400" />
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="text-sm border-gray-300 rounded-md"
            >
              <option value="all">{t("common.all")} {t("signals.severity")}</option>
              <option value="critical">{t("signals.severityLevels.critical")}</option>
              <option value="high">{t("signals.severityLevels.high")}</option>
              <option value="medium">{t("signals.severityLevels.medium")}</option>
              <option value="low">{t("signals.severityLevels.low")}</option>
            </select>
          </div>
        </div>

        <div className="space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-moss-600" />
            </div>
          ) : filteredSignals.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <Activity className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p>{t("signals.noSignals")}</p>
              <p className="text-sm">
                {hasAdminKey ? t("signals.clickToCollect") : t("signals.noSignalsPublic")}
              </p>
            </div>
          ) : (
            rows.map((row) => (
              <SignalCard key={row.key} row={row} t={t} locale={locale} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
