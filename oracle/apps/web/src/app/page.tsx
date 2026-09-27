"use client";

import { useQuery } from "@tanstack/react-query";
import { useFormatter, useTranslations } from "next-intl";
import { api } from "@/lib/api";
import {
  Activity,
  AlertTriangle,
  Vote,
  CheckCircle,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import Link from "next/link";

type Stats = Awaited<ReturnType<typeof api.getStats>>;

// How many of the newest detected issues to scan for one that was observed
// rather than invented by the demo adapter. Issues are small once their
// embedded signals are dropped, so this stays a few kilobytes.
const ISSUE_LOOKBACK = 50;

function StatCard({
  title,
  value,
  detail,
  icon: Icon,
  trend,
  href,
}: {
  title: string;
  value: string | number;
  /** Secondary figure under the headline, e.g. the raw rows behind it. */
  detail?: string;
  icon: React.ElementType;
  trend?: string;
  href?: string;
}) {
  const content = (
    <div className="card hover:shadow-md transition-shadow cursor-pointer p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <div className="min-w-0 flex-1">
          {/* Wraps rather than truncates: these labels say what the number
              counts, and on a two-column phone grid a clipped one hides it. */}
          <p className="text-xs sm:text-sm font-medium text-gray-500 leading-snug">{title}</p>
          <p className="mt-1 text-xl sm:text-2xl font-semibold text-gray-900">{value}</p>
          {detail && <p className="mt-0.5 text-xs text-gray-500 leading-snug">{detail}</p>}
          {trend && (
            <p className="mt-1 text-xs sm:text-sm text-moss-600 flex items-center">
              <TrendingUp className="w-3 h-3 sm:w-4 sm:h-4 mr-1" />
              {trend}
            </p>
          )}
        </div>
        <div className="p-2 sm:p-3 bg-moss-50 rounded-lg ml-2 flex-shrink-0">
          <Icon className="w-5 h-5 sm:w-6 sm:h-6 text-moss-600" />
        </div>
      </div>
    </div>
  );

  if (href) {
    return <Link href={href}>{content}</Link>;
  }
  return content;
}

function WelcomeBanner() {
  const t = useTranslations();

  return (
    <div className="card bg-gradient-to-r from-moss-600 to-moss-700 text-white">
      <div className="flex items-center space-x-4">
        <div className="p-3 bg-white/20 rounded-lg">
          <Zap className="w-8 h-8" />
        </div>
        <div>
          <h3 className="text-lg font-semibold">BRIDGE 2026</h3>
          <p className="text-moss-100">
            {t("common.tagline")}
          </p>
        </div>
      </div>
    </div>
  );
}

function ActivityRow({
  icon: Icon,
  iconClassName,
  label,
  href,
  children,
}: {
  icon: React.ElementType;
  iconClassName: string;
  label: string;
  href: string;
  children: React.ReactNode;
}) {
  return (
    <li className="border-b border-gray-100 last:border-0">
      <Link
        href={href}
        className="flex items-start space-x-3 py-2 -mx-2 px-2 rounded-lg hover:bg-gray-50 transition-colors"
      >
        <Icon aria-hidden="true" className={`w-5 h-5 mt-0.5 flex-shrink-0 ${iconClassName}`} />
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900">{label}</p>
          <div className="text-xs text-gray-500">{children}</div>
        </div>
      </Link>
    </li>
  );
}

/**
 * What the service has actually done lately, read from the same light
 * endpoints as the rest of the dashboard.
 *
 * This replaces a hardcoded list that told every visitor a proposal had
 * passed an hour ago and an outcome had been verified yesterday, while
 * /api/stats reported 0 passed proposals and 0 proofs. Every row now either
 * shows a real observation with its real time or says plainly that there is
 * none; a row whose request failed says so instead of falling back to a
 * guess. /api/proposals is deliberately not read here — it is several
 * megabytes, and the active count in /api/stats is all this card needs.
 */
function RecentActivity({
  stats,
  statsPending,
  statsFailed,
}: {
  stats: Stats | undefined;
  statsPending: boolean;
  statsFailed: boolean;
}) {
  const t = useTranslations();
  const format = useFormatter();

  // lastObservedSignalAt skips the demo adapter, which keeps writing signals
  // while real collection is down; the newest row of /api/signals would make
  // a stalled pipeline look alive.
  const health = useQuery({
    queryKey: ["home", "health"],
    queryFn: () => api.getHealth(),
    refetchInterval: 60000,
  });

  // status=detected is listed newest first; the default listing is ordered by
  // priority, so its first row is not the latest one.
  const latestIssue = useQuery({
    queryKey: ["home", "latestObservedIssue"],
    queryFn: async () => {
      const { issues } = await api.getIssues("detected", {
        limit: ISSUE_LOOKBACK,
        includeSignals: false,
      });
      return issues.find((issue) => !issue.synthetic) ?? null;
    },
    refetchInterval: 60000,
  });

  const now = new Date();
  // null for a missing or unparseable time, so it renders as the empty state
  // rather than "Invalid Date".
  const ago = (value: string | null | undefined) => {
    if (!value) return null;
    const at = new Date(value);
    return Number.isNaN(at.getTime()) ? null : format.relativeTime(at, now);
  };

  // Keyed on isPending (no data yet), not isLoading: isLoading is
  // isPending && isFetching, so a query paused offline or mid-retry in a
  // hidden tab has neither isLoading nor isError and no data, and would fall
  // through to the empty-state copy — asserting "no signals" or "no outcomes"
  // about an API we never heard back from.
  const pending = (waiting: boolean, failed: boolean) =>
    waiting ? t("common.loading") : failed ? t("errors.fetchFailed") : null;

  const signalAgo = ago(health.data?.lastObservedSignalAt);
  const issueAgo = ago(latestIssue.data?.detectedAt);
  const activeProposals = stats?.proposals.active ?? 0;
  const measuredOutcomes = stats?.outcomes.totalProofs ?? 0;

  return (
    <div className="card">
      <h3 className="text-lg font-semibold text-gray-900">{t("dashboard.recentActivity")}</h3>
      <p className="mt-1 mb-4 text-xs text-gray-500">{t("dashboard.recentActivityNote")}</p>
      <ul>
        <ActivityRow
          icon={Activity}
          iconClassName="text-blue-500"
          label={t("dashboard.latestSignal")}
          href="/signals"
        >
          {pending(health.isPending, health.isError) ??
            (signalAgo
              ? t("dashboard.observedAgo", { time: signalAgo })
              : t("dashboard.noObservedSignal"))}
        </ActivityRow>
        <ActivityRow
          icon={AlertTriangle}
          iconClassName="text-orange-500"
          label={t("dashboard.latestIssue")}
          href="/issues"
        >
          {pending(latestIssue.isPending, latestIssue.isError) ??
            (latestIssue.data ? (
              <>
                <span className="block truncate text-gray-700">{latestIssue.data.title}</span>
                {issueAgo && t("dashboard.detectedAgo", { time: issueAgo })}
              </>
            ) : (
              t("dashboard.noObservedIssue")
            ))}
        </ActivityRow>
        <ActivityRow
          icon={Vote}
          iconClassName="text-purple-500"
          label={t("dashboard.activeProposals")}
          href="/proposals"
        >
          {pending(statsPending, statsFailed) ??
            (activeProposals > 0
              ? t("dashboard.activeProposalCount", { count: activeProposals })
              : t("dashboard.noActiveProposals"))}
        </ActivityRow>
        <ActivityRow
          icon={CheckCircle}
          iconClassName="text-green-500"
          label={t("dashboard.measuredOutcomes")}
          href="/outcomes"
        >
          {pending(statsPending, statsFailed) ??
            (measuredOutcomes > 0
              ? t("dashboard.measuredOutcomeCount", { count: measuredOutcomes })
              : t("dashboard.noOutcomesMeasured"))}
        </ActivityRow>
      </ul>
    </div>
  );
}

export default function Dashboard() {
  const t = useTranslations();
  // format.number is Intl.NumberFormat for the active locale: "881,519"
  // rather than "881519", which is hard to read at a glance in either language.
  const format = useFormatter();
  const num = (value: number | undefined) => format.number(value ?? 0);

  const {
    data: stats,
    isPending: statsPending,
    isError: statsFailed,
  } = useQuery({
    queryKey: ["stats"],
    queryFn: () => api.getStats(),
    refetchInterval: 30000,
  });

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">{t("dashboard.title")}</h1>
        <p className="mt-1 text-gray-500">
          {t("dashboard.subtitle")}
        </p>
      </div>

      {/* Welcome Banner */}
      <WelcomeBanner />

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
        {/*
          The signal total counts stored rows, most of them repeats of the
          previous minute's reading, so it is labelled as rows rather than as
          signals. The last-24h figure is how many rows were stored, not
          whether collection is running: once only changed readings are
          stored, a quiet day stores few. Issues lead with distinct open
          conditions: a persisting condition used to add a row every pass, and
          754 rows were 12 conditions when this was written. The secondary
          figure is the open rows those conditions are counted over, not the
          all-time total, so the two numbers always describe the same issues.
        */}
        <StatCard
          title={t("dashboard.totalSignals")}
          value={statsPending ? "..." : num(stats?.signals.total)}
          detail={
            stats
              ? t("dashboard.signalRowsLastDay", { count: num(stats.signals.lastDay) })
              : undefined
          }
          icon={Activity}
          href="/signals"
        />
        <StatCard
          title={t("dashboard.issueConditions")}
          value={statsPending ? "..." : num(stats?.issues.conditions)}
          detail={
            stats ? t("dashboard.issueOpenRows", { count: num(stats.issues.openRows) }) : undefined
          }
          icon={AlertTriangle}
          href="/issues"
        />
        <StatCard
          title={t("dashboard.activeProposals")}
          value={statsPending ? "..." : stats?.proposals.active ?? 0}
          icon={Vote}
          href="/proposals"
        />
        <StatCard
          title={t("dashboard.successRate")}
          value={
            statsPending
              ? "..."
              : stats?.outcomes.successRate == null
                ? "—"
                : `${(stats.outcomes.successRate * 100).toFixed(0)}%`
          }
          icon={Users}
          href="/outcomes"
        />
      </div>

      {/* Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RecentActivity
          stats={stats}
          statsPending={statsPending}
          statsFailed={statsFailed}
        />

        {/* Quick Actions */}
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            {t("common.view")}
          </h3>
          <div className="grid grid-cols-2 gap-2 sm:gap-4">
            <Link href="/signals" className="btn-secondary text-center text-sm sm:text-base py-2 sm:py-2">
              {t("nav.signals")}
            </Link>
            <Link href="/issues" className="btn-secondary text-center text-sm sm:text-base py-2 sm:py-2">
              {t("nav.issues")}
            </Link>
            <Link href="/proposals" className="btn-primary text-center text-sm sm:text-base py-2 sm:py-2">
              {t("nav.proposals")}
            </Link>
            <Link href="/delegation" className="btn-secondary text-center text-sm sm:text-base py-2 sm:py-2">
              {t("nav.delegation")}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
