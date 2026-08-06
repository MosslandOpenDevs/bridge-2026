"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { CheckCircle, XCircle, BarChart3, ExternalLink, Loader2 } from "lucide-react";
import { cn, timeAgo } from "@/lib/utils";
import { api } from "@/lib/api";

interface KPI {
  name: string;
  target: number;
  actual: number;
  unit: string;
  success: boolean | null;
}

function KPICard({ kpi }: { kpi: KPI }) {
  const progress = kpi.target > 0 ? (kpi.actual / kpi.target) * 100 : 0;
  const isComplete = kpi.success !== null;

  return (
    <div className="p-4 bg-gray-50 rounded-lg">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-700">{kpi.name}</span>
        {isComplete && (
          kpi.success
            ? <CheckCircle className="w-5 h-5 text-green-500" />
            : <XCircle className="w-5 h-5 text-red-500" />
        )}
      </div>
      <div className="flex items-end justify-between">
        <div>
          <span className="text-2xl font-bold text-gray-900">{kpi.actual.toLocaleString()}</span>
          <span className="text-sm text-gray-500 ml-1">{kpi.unit}</span>
        </div>
        <span className="text-sm text-gray-500">Target: {kpi.target.toLocaleString()}{kpi.unit}</span>
      </div>
      {isComplete && (
        <div className="mt-2">
          <div className="w-full h-2 bg-gray-200 rounded-full">
            <div
              className={cn("h-2 rounded-full", kpi.success ? "bg-green-500" : "bg-red-500")}
              style={{ width: `${Math.min(progress, 100)}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default function OutcomesPage() {
  const t = useTranslations();
  const [selectedOutcome, setSelectedOutcome] = useState<any>(null);
  const [leaderboardType, setLeaderboardType] = useState<string>("agent");

  const { data: statsData, isLoading: statsLoading } = useQuery({
    queryKey: ["stats"],
    queryFn: () => api.getStats(),
  });

  const { data: outcomesData, isLoading: outcomesLoading } = useQuery({
    queryKey: ["outcomes"],
    queryFn: () => api.getOutcomes(),
    refetchInterval: 30000,
  });

  const { data: leaderboardData, isLoading: leaderboardLoading } = useQuery({
    queryKey: ["trust-leaderboard", leaderboardType],
    queryFn: () => api.getLeaderboard(leaderboardType, 10),
  });

  const outcomes = outcomesData?.outcomes ?? [];
  const completedCount = statsData?.outcomes.totalProofs ?? 0;
  const successRate = (statsData?.outcomes.successRate ?? 0) * 100;
  const successCount = outcomes.filter((o: any) => o.overallSuccess).length;
  const trustScores = leaderboardData?.leaderboard ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">{t("outcomes.title")}</h1>
        <p className="mt-1 text-sm sm:text-base text-gray-500">{t("outcomes.subtitle")}</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        <div className="card p-4 sm:p-6">
          <p className="text-xs sm:text-sm text-gray-500 truncate">{t("outcomes.executionRecord")}</p>
          <p className="text-xl sm:text-2xl font-bold text-gray-900">
            {outcomesLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : outcomes.length}
          </p>
        </div>
        <div className="card p-4 sm:p-6">
          <p className="text-xs sm:text-sm text-gray-500 truncate">{t("outcomes.verified")}</p>
          <p className="text-xl sm:text-2xl font-bold text-gray-900">
            {outcomesLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : completedCount}
          </p>
        </div>
        <div className="card p-4 sm:p-6">
          <p className="text-xs sm:text-sm text-gray-500 truncate">{t("proposals.passed")}</p>
          <p className="text-xl sm:text-2xl font-bold text-green-600">
            {outcomesLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : successCount}
          </p>
        </div>
        <div className="card p-4 sm:p-6">
          <p className="text-xs sm:text-sm text-gray-500 truncate">{t("dashboard.successRate")}</p>
          <p className="text-xl sm:text-2xl font-bold text-moss-600">
            {statsLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : `${successRate.toFixed(0)}%`}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">{t("outcomes.executionRecord")}</h2>
          {outcomesLoading ? (
            <div className="card flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-moss-600" />
            </div>
          ) : outcomes.length === 0 ? (
            <div className="card text-center py-12 text-gray-500">
              <BarChart3 className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p>{t("outcomes.noOutcomes")}</p>
              <p className="text-sm">{t("outcomes.outcomeAfterExecution")}</p>
            </div>
          ) : (
            outcomes.map((outcome) => (
              <div
                key={outcome.id}
                onClick={() => setSelectedOutcome(outcome)}
                className={cn(
                  "card cursor-pointer hover:shadow-md transition-all p-4 sm:p-6",
                  selectedOutcome?.id === outcome.id && "ring-2 ring-moss-500"
                )}
              >
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center flex-wrap gap-1 sm:gap-2 mb-2">
                      {/* "measured" is the API's status for an outcome whose
                          KPIs have actually been observed; anything else is
                          still awaiting measurement. */}
                      {outcome.status === "measured" ? (
                        outcome.overallSuccess ? (
                          <span className="badge bg-green-50 text-green-700 text-xs">
                            <CheckCircle className="w-3 h-3 mr-1" />
                            {t("outcomes.verified")}
                          </span>
                        ) : (
                          <span className="badge bg-red-50 text-red-700 text-xs">
                            <XCircle className="w-3 h-3 mr-1" />
                            {t("proposals.rejected")}
                          </span>
                        )
                      ) : (
                        <span className="badge bg-blue-50 text-blue-700 text-xs">{t("outcomes.pending")}</span>
                      )}
                    </div>
                    <h3 className="font-semibold text-gray-900 text-sm sm:text-base line-clamp-2">{outcome.proposalTitle}</h3>
                    <p className="mt-1 text-xs sm:text-sm text-gray-500">{timeAgo(new Date(outcome.executedAt))}</p>
                  </div>
                  <div className="text-left sm:text-right flex sm:flex-col items-center sm:items-end gap-2 flex-shrink-0">
                    <p className="text-xs sm:text-sm text-gray-500">KPI {outcome.kpis.length}</p>
                    {outcome.proofHash && (
                      <a href="#" className="text-xs sm:text-sm text-moss-600 flex items-center" onClick={(e) => e.stopPropagation()}>
                        {t("outcomes.proof")}
                        <ExternalLink className="w-3 h-3 ml-1" />
                      </a>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="space-y-6">
          {selectedOutcome ? (
            <div className="card sticky top-24">
              <h3 className="font-semibold text-gray-900 mb-4">{t("outcomes.kpiResults")}</h3>
              <div className="space-y-3">
                {selectedOutcome.kpis.map((kpi: KPI, idx: number) => (
                  <KPICard key={idx} kpi={kpi} />
                ))}
              </div>
            </div>
          ) : (
            <div className="card text-center py-12 text-gray-500">
              <BarChart3 className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p>{t("common.view")}</p>
            </div>
          )}

          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">{t("outcomes.trustScores")}</h3>
              <select
                value={leaderboardType}
                onChange={(e) => setLeaderboardType(e.target.value)}
                className="text-sm border-gray-300 rounded-lg"
              >
                <option value="agent">Agents</option>
                <option value="proposer">Proposers</option>
                <option value="delegate">Delegates</option>
              </select>
            </div>
            {leaderboardLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-moss-600" />
              </div>
            ) : trustScores.length === 0 ? (
              <p className="text-center py-8 text-gray-500">{t("outcomes.noOutcomes")}</p>
            ) : (
              <div className="space-y-3">
                {trustScores.map((score: any, idx: number) => (
                  <div key={score.entityId} className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <span className={cn(
                        "w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold",
                        idx === 0 ? "bg-yellow-100 text-yellow-700" :
                        idx === 1 ? "bg-gray-100 text-gray-700" :
                        idx === 2 ? "bg-orange-100 text-orange-700" :
                        "bg-gray-50 text-gray-500"
                      )}>
                        {idx + 1}
                      </span>
                      <span className="text-sm text-gray-700 font-mono truncate max-w-[120px]">
                        {score.entityId.length > 15 ? `${score.entityId.slice(0, 8)}...` : score.entityId}
                      </span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <span className="text-sm font-semibold">{score.score?.toFixed(0) ?? 50}</span>
                      <div className="w-16 h-2 bg-gray-200 rounded-full">
                        <div
                          className={cn(
                            "h-2 rounded-full",
                            (score.score ?? 50) >= 70 ? "bg-green-500" :
                            (score.score ?? 50) >= 40 ? "bg-yellow-500" : "bg-red-500"
                          )}
                          style={{ width: `${score.score ?? 50}%` }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
