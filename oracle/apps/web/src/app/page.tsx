"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
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

function StatCard({
  title,
  value,
  icon: Icon,
  trend,
  href,
}: {
  title: string;
  value: string | number;
  icon: React.ElementType;
  trend?: string;
  href?: string;
}) {
  const content = (
    <div className="card hover:shadow-md transition-shadow cursor-pointer p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-xs sm:text-sm font-medium text-gray-500 truncate">{title}</p>
          <p className="mt-1 text-xl sm:text-2xl font-semibold text-gray-900">{value}</p>
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

function RecentActivity() {
  const t = useTranslations();

  const activities = [
    {
      id: 1,
      type: "signal",
      titleKey: "signals.title",
      time: "5m",
      severity: "high",
    },
    {
      id: 2,
      type: "proposal",
      titleKey: "proposals.title",
      time: "1h",
      status: "passed",
    },
    {
      id: 3,
      type: "issue",
      titleKey: "issues.title",
      time: "3h",
      severity: "medium",
    },
    {
      id: 4,
      type: "outcome",
      titleKey: "outcomes.title",
      time: "1d",
      success: true,
    },
  ];

  return (
    <div className="card">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">{t("dashboard.recentSignals")}</h3>
      <div className="space-y-4">
        {activities.map((activity) => (
          <div
            key={activity.id}
            className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0"
          >
            <div className="flex items-center space-x-3">
              {activity.type === "signal" && (
                <Activity className="w-5 h-5 text-blue-500" />
              )}
              {activity.type === "proposal" && (
                <Vote className="w-5 h-5 text-purple-500" />
              )}
              {activity.type === "issue" && (
                <AlertTriangle className="w-5 h-5 text-orange-500" />
              )}
              {activity.type === "outcome" && (
                <CheckCircle className="w-5 h-5 text-green-500" />
              )}
              <div>
                <p className="text-sm font-medium text-gray-900">
                  {t(activity.titleKey)}
                </p>
                <p className="text-xs text-gray-500">{activity.time}</p>
              </div>
            </div>
            {activity.severity && (
              <span
                className={`badge ${
                  activity.severity === "high"
                    ? "bg-red-50 text-red-700"
                    : "bg-yellow-50 text-yellow-700"
                }`}
              >
                {t(`signals.severityLevels.${activity.severity}`)}
              </span>
            )}
            {activity.status && (
              <span className="badge bg-green-50 text-green-700">
                {t(`proposals.${activity.status}`)}
              </span>
            )}
            {activity.success !== undefined && (
              <span className="badge bg-green-50 text-green-700">{t("outcomes.verified")}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const t = useTranslations();

  const { data: stats, isLoading: statsLoading } = useQuery({
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
        <StatCard
          title={t("dashboard.totalSignals")}
          value={statsLoading ? "..." : stats?.signals.total ?? 0}
          icon={Activity}
          href="/signals"
        />
        <StatCard
          title={t("issues.title")}
          value={statsLoading ? "..." : stats?.issues.total ?? 0}
          icon={AlertTriangle}
          href="/issues"
        />
        <StatCard
          title={t("dashboard.activeProposals")}
          value={statsLoading ? "..." : stats?.proposals.active ?? 0}
          icon={Vote}
          href="/proposals"
        />
        <StatCard
          title={t("dashboard.successRate")}
          value={
            statsLoading
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
        <RecentActivity />

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
