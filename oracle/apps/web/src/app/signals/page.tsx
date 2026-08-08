"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
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
} from "lucide-react";
import { cn, getSeverityColor, timeAgo } from "@/lib/utils";
import { api } from "@/lib/api";

const sourceIcons: Record<string, React.ElementType> = {
  onchain: Zap,
  telemetry: Server,
  api: Globe,
};

function SignalCard({ signal, t }: { signal: any; t: any }) {
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
    telemetry: "Telemetry",
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
              <span className="hidden sm:inline">{signal.category?.replace(/_/g, " ") || "unknown"}</span>
              <span className="sm:hidden">{(signal.category?.split("_")[0]) || "unknown"}</span>
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

          <p className="mt-2 text-sm sm:text-base text-gray-900 font-medium line-clamp-2">
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

          <div className="mt-2 flex items-center gap-2 sm:gap-4 text-xs sm:text-sm text-gray-500">
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {timeAgo(new Date(signal.timestamp))}
            </span>
            {metadata.blockNumber && (
              <span className="flex items-center gap-1">
                <Layers className="w-3 h-3" />
                <span className="hidden sm:inline">Block #</span>{metadata.blockNumber.toLocaleString()}
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
            onClick={() => setIsExpanded(!isExpanded)}
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
                Signal ID
              </span>
              <p className="mt-1 text-sm font-mono text-gray-700 truncate">
                {signal.id}
              </p>
            </div>

            {signal.originalId && (
              <div>
                <span className="text-xs font-medium text-gray-500 uppercase">
                  Original ID
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
                  Transaction Hash
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
                  Block Number
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
                  API Endpoint
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
                {new Date(signal.timestamp).toLocaleString()}
              </p>
            </div>

            {signal.rawData && (
              <div className="md:col-span-2">
                <span className="text-xs font-medium text-gray-500 uppercase">
                  Raw Data
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
    telemetry: "Telemetry",
    api: t("signals.api"),
  };

  return (
    <div className="space-y-6">
      {/* Real-time Notification Toast */}
      {realtimeNotification?.show && (
        <div className="fixed top-20 right-4 z-50 bg-moss-500 text-white px-4 py-3 rounded-lg shadow-lg flex items-center space-x-2 animate-in fade-in slide-in-from-top-2">
          <Bell className="w-5 h-5" />
          <span className="font-medium">+{realtimeNotification.count} new signals collected</span>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">{t("signals.title")}</h1>
          <p className="mt-1 text-sm sm:text-base text-gray-500">{t("signals.subtitle")}</p>
        </div>
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
            <span className="text-xs text-gray-400">+{categories.length - 10} more</span>
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
                ({filteredSignals.length})
              </span>
            </h2>
            <p className="text-xs text-gray-400 mt-1">
              {t("signals.maxDisplayNote", { max: 500 })}
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
              <p className="text-sm">{t("signals.clickToCollect")}</p>
            </div>
          ) : (
            filteredSignals.map((signal: any) => (
              <SignalCard key={signal.id} signal={signal} t={t} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
