"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useAccount } from "@/hooks/useMOC";
import { AlertTriangle, MessageSquare, Users, Shield, Coins, Code, ChevronRight, Bot, Loader2, RefreshCw, CheckCircle, Clock, MessageCircle } from "lucide-react";
import { cn, timeAgo } from "@/lib/utils";
import { useToast } from "@/contexts/ToastContext";
import { api } from "@/lib/api";
import { useHasAdminKey } from "@/hooks/useAdminKey";
import { DebatePanel } from "@/components/DebatePanel";

// Progress component for deliberation
function DeliberationProgress({ isActive }: { isActive: boolean }) {
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState(0);
  const t = useTranslations();

  const stages = [
    { label: "Risk Agent 분석 중...", duration: 3000 },
    { label: "Treasury Agent 분석 중...", duration: 3000 },
    { label: "Community Agent 분석 중...", duration: 3000 },
    { label: "Product Agent 분석 중...", duration: 3000 },
    { label: "Moderator 종합 중...", duration: 2000 },
  ];

  useEffect(() => {
    if (!isActive) {
      setProgress(0);
      setStage(0);
      return;
    }

    const totalDuration = stages.reduce((sum, s) => sum + s.duration, 0);
    const startTime = Date.now();

    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const newProgress = Math.min((elapsed / totalDuration) * 100, 95);
      setProgress(newProgress);

      // Determine current stage
      let accumulatedDuration = 0;
      for (let i = 0; i < stages.length; i++) {
        accumulatedDuration += stages[i].duration;
        if (elapsed < accumulatedDuration) {
          setStage(i);
          break;
        }
      }
    }, 100);

    return () => clearInterval(interval);
  }, [isActive]);

  if (!isActive) return null;

  return (
    <div className="space-y-3 py-4">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center space-x-2">
          <Loader2 className="w-4 h-4 animate-spin text-moss-600" />
          <span className="text-gray-600">{stages[stage]?.label || "분석 중..."}</span>
        </div>
        <div className="flex items-center space-x-1 text-gray-400">
          <Clock className="w-3 h-3" />
          <span className="text-xs">약 15초 소요</span>
        </div>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2">
        <div
          className="bg-moss-500 h-2 rounded-full transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="flex justify-between text-xs text-gray-400">
        <span>4개 에이전트 심의 + Moderator 종합</span>
        <span>{Math.round(progress)}%</span>
      </div>
    </div>
  );
}

const priorityColors: Record<string, string> = {
  urgent: "bg-red-100 text-red-700",
  high: "bg-orange-100 text-orange-700",
  medium: "bg-yellow-100 text-yellow-700",
  low: "bg-green-100 text-green-700",
};

const categoryIcons: Record<string, React.ElementType> = {
  governance: Users,
  security: Shield,
  treasury: Coins,
  product: Code,
};

const stanceColors: Record<string, string> = {
  strongly_support: "bg-green-500",
  support: "bg-green-300",
  neutral: "bg-gray-300",
  oppose: "bg-red-300",
  strongly_oppose: "bg-red-500",
};

export default function IssuesPage() {
  const t = useTranslations();
  const tToast = useTranslations("toast");
  const tAdmin = useTranslations("admin");
  const hasAdminKey = useHasAdminKey();
  const toast = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { address } = useAccount();
  const [selectedIssue, setSelectedIssue] = useState<any>(null);
  const [proposalCreated, setProposalCreated] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["issues"],
    queryFn: () => api.getIssues(),
    refetchInterval: 30000,
  });

  const detectMutation = useMutation({
    mutationFn: () => api.detectIssues(),
    onSuccess: () => {
      refetch();
    },
  });

  const deliberateMutation = useMutation({
    mutationFn: (issue: any) => api.deliberate(issue),
    onSuccess: (result) => {
      if (selectedIssue) {
        setSelectedIssue({ ...selectedIssue, decisionPacket: result.decisionPacket });
      }
      toast.success(tToast("deliberationCompleted.title"), tToast("deliberationCompleted.message"), {
        category: "issue",
      });
    },
    onMutate: () => {
      toast.info(tToast("deliberationStarted.title"), tToast("deliberationStarted.message"), {
        category: "issue",
        duration: 3000,
      });
    },
  });

  const debateMutation = useMutation({
    mutationFn: (issue: any) => api.startDebate(issue, {}, 3),
    onSuccess: (result) => {
      if (selectedIssue) {
        setSelectedIssue({
          ...selectedIssue,
          debateSession: result.debateSession,
          decisionPacket: result.decisionPacket,
        });
      }
    },
  });

  const createProposalMutation = useMutation({
    mutationFn: ({ decisionPacket, proposer }: { decisionPacket: any; proposer: string }) =>
      api.createProposal(decisionPacket, proposer),
    onSuccess: () => {
      setProposalCreated(true);
      queryClient.invalidateQueries({ queryKey: ["proposals"] });
      // Update issue status
      if (selectedIssue) {
        api.updateIssue(selectedIssue.id, { status: "proposed" });
        refetch();
      }
      setTimeout(() => {
        router.push("/proposals");
      }, 1500);
    },
  });

  const issues = data?.issues ?? [];

  const roleLabels: Record<string, string> = {
    risk: "Risk",
    treasury: t("delegation.treasury"),
    community: t("delegation.community"),
    product: "Product",
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">{t("issues.title")}</h1>
          <p className="mt-1 text-sm sm:text-base text-gray-500">{t("issues.subtitle")}</p>
        </div>
        <button
          onClick={() => detectMutation.mutate()}
          disabled={isLoading || detectMutation.isPending || !hasAdminKey}
          title={hasAdminKey ? undefined : tAdmin("required")}
          className="btn-primary flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed w-full sm:w-auto"
        >
          {detectMutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4" />
          )}
          <span>{detectMutation.isPending ? t("issues.detecting") : t("issues.detect")}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Issues List */}
        <div className="lg:col-span-2 space-y-4">
          {isLoading ? (
            <div className="card flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-moss-600" />
            </div>
          ) : issues.length === 0 ? (
            <div className="card text-center py-12 text-gray-500">
              <AlertTriangle className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p>{t("issues.noIssues")}</p>
              <p className="text-sm">{t("issues.systemNormal")}</p>
            </div>
          ) : (
            issues.map((issue: any) => {
              const CategoryIcon = categoryIcons[issue.category] || AlertTriangle;
              const agentOpinions = issue.agentOpinions || [];
              return (
                <div
                  key={issue.id}
                  onClick={() => setSelectedIssue(issue)}
                  className={cn(
                    "card cursor-pointer hover:shadow-md transition-all p-4 sm:p-6",
                    selectedIssue?.id === issue.id && "ring-2 ring-moss-500"
                  )}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start space-x-3 flex-1 min-w-0">
                      <div className="p-2 bg-gray-100 rounded-lg flex-shrink-0 hidden sm:block">
                        <CategoryIcon className="w-5 h-5 text-gray-600" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center flex-wrap gap-1 sm:gap-2">
                          <span className={cn("badge text-xs", priorityColors[issue.priority] || "bg-gray-100 text-gray-700")}>
                            {(issue.priority || "medium").toUpperCase()}
                          </span>
                          <span className="badge bg-blue-50 text-blue-600 text-xs">
                            {issue.status}
                          </span>
                        </div>
                        <h3 className="mt-2 font-semibold text-gray-900 text-sm sm:text-base line-clamp-2">{issue.title}</h3>
                        <p className="mt-1 text-xs sm:text-sm text-gray-500 line-clamp-2">{issue.description}</p>
                        <div className="mt-2 flex items-center flex-wrap gap-2 sm:gap-4 text-xs text-gray-400">
                          <span>{timeAgo(new Date(issue.detectedAt))}</span>
                          <span>{t("issues.relatedSignals")}: {issue.signalCount || 0}</span>
                        </div>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-gray-400 flex-shrink-0 ml-2" />
                  </div>

                  {agentOpinions.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-gray-100">
                      <div className="flex items-center flex-wrap gap-2">
                        <Bot className="w-4 h-4 text-moss-600" />
                        <span className="text-xs sm:text-sm text-gray-500">{t("issues.agentDeliberation")}:</span>
                        {agentOpinions.map((opinion: any) => (
                          <div key={opinion.role} className="flex items-center space-x-1">
                            <div className={cn("w-2 h-2 rounded-full", stanceColors[opinion.stance] || "bg-gray-300")} />
                            <span className="text-xs text-gray-600">{roleLabels[opinion.role] || opinion.role}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Issue Detail / Decision Packet */}
        <div className="lg:col-span-1">
          {selectedIssue ? (
            <div className="card sticky top-24 max-h-[calc(100vh-8rem)] overflow-y-auto">
              <h3 className="font-semibold text-gray-900 mb-4 sticky top-0 bg-white pb-2 -mt-2 pt-2">Decision Packet</h3>

              {!selectedIssue.decisionPacket && (!selectedIssue.agentOpinions || selectedIssue.agentOpinions.length === 0) ? (
                <div className="text-center py-8 text-gray-500">
                  <Bot className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                  <p>{t("issues.agentDeliberation")}</p>
                  {!deliberateMutation.isPending && !debateMutation.isPending && (
                    <div className="flex flex-col space-y-2 mt-4">
                      <button
                        onClick={() => deliberateMutation.mutate(selectedIssue)}
                        disabled={deliberateMutation.isPending || debateMutation.isPending || !hasAdminKey}
                        title={hasAdminKey ? undefined : tAdmin("required")}
                        className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {t("issues.deliberate")}
                      </button>
                      <button
                        onClick={() => debateMutation.mutate(selectedIssue)}
                        disabled={deliberateMutation.isPending || debateMutation.isPending || !hasAdminKey}
                        title={hasAdminKey ? undefined : tAdmin("required")}
                        className="btn-secondary flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <MessageCircle className="w-4 h-4" />
                        <span>{t("issues.startDebate")}</span>
                      </button>
                    </div>
                  )}
                  <DeliberationProgress isActive={deliberateMutation.isPending} />
                  {debateMutation.isPending && (
                    <div className="mt-4 space-y-2">
                      <div className="flex items-center justify-center space-x-2 text-moss-600">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>{t("issues.debating") || "Debating..."}</span>
                      </div>
                      <p className="text-xs text-gray-400">Multi-round debate in progress...</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Debate Panel - Show if debate session exists */}
                  {selectedIssue.debateSession && (
                    <DebatePanel
                      session={selectedIssue.debateSession}
                      isLoading={debateMutation.isPending}
                    />
                  )}

                  {selectedIssue.decisionPacket?.agentOpinions && !selectedIssue.debateSession && (
                    <div>
                      <h4 className="text-sm font-medium text-gray-500 mb-2">{t("issues.agentDeliberation")}</h4>
                      <div className="space-y-2">
                        {selectedIssue.decisionPacket.agentOpinions.map((opinion: any) => (
                          <div key={opinion.agentRole} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
                            <div className="flex items-center space-x-2">
                              <div className={cn("w-3 h-3 rounded-full", stanceColors[opinion.stance] || "bg-gray-300")} />
                              <span className="text-sm font-medium">{roleLabels[opinion.agentRole] || opinion.agentRole}</span>
                            </div>
                            <span className="text-sm text-gray-500">
                              {Math.round((opinion.confidence || 0) * 100)}% {t("issues.confidence")}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {selectedIssue.decisionPacket?.recommendation && (
                    <div>
                      <h4 className="text-sm font-medium text-gray-500 mb-2">{t("issues.recommendation")}</h4>
                      <div className="text-sm text-gray-700 p-3 bg-moss-50 rounded-lg space-y-2">
                        {typeof selectedIssue.decisionPacket.recommendation === "string" ? (
                          <p>{selectedIssue.decisionPacket.recommendation}</p>
                        ) : (
                          <>
                            <div>
                              <span className="font-medium">{t("issues.action")}:</span>{" "}
                              {selectedIssue.decisionPacket.recommendation.action}
                            </div>
                            <div>
                              <span className="font-medium">{t("issues.rationale")}:</span>{" "}
                              {selectedIssue.decisionPacket.recommendation.rationale}
                            </div>
                            <div>
                              <span className="font-medium">{t("issues.expectedOutcome")}:</span>{" "}
                              {selectedIssue.decisionPacket.recommendation.expectedOutcome}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  {selectedIssue.decisionPacket?.risks && selectedIssue.decisionPacket.risks.length > 0 && (
                    <div>
                      <h4 className="text-sm font-medium text-gray-500 mb-2">{t("issues.risks")}</h4>
                      <div className="space-y-2">
                        {selectedIssue.decisionPacket.risks.map((risk: any, i: number) => (
                          <div key={i} className="text-sm p-3 bg-red-50 rounded-lg">
                            {typeof risk === "string" ? (
                              <p>{risk}</p>
                            ) : (
                              <>
                                <p className="font-medium text-red-700">{risk.description}</p>
                                <div className="mt-1 flex flex-wrap gap-2 text-xs">
                                  <span className="px-2 py-0.5 bg-red-100 rounded">
                                    {t("issues.likelihood")}: {risk.likelihood}
                                  </span>
                                  <span className="px-2 py-0.5 bg-red-100 rounded">
                                    {t("issues.impact")}: {risk.impact}
                                  </span>
                                </div>
                                {risk.mitigation && (
                                  <p className="mt-1 text-gray-600">
                                    <span className="font-medium">{t("issues.mitigation")}:</span> {risk.mitigation}
                                  </p>
                                )}
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="pt-4 border-t border-gray-100 space-y-2">
                    {proposalCreated ? (
                      <div className="flex items-center justify-center space-x-2 py-3 text-green-600">
                        <CheckCircle className="w-5 h-5" />
                        <span>{t("issues.proposalCreated")}</span>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          if (selectedIssue?.decisionPacket) {
                            createProposalMutation.mutate({
                              decisionPacket: selectedIssue.decisionPacket,
                              proposer: address || "anonymous",
                            });
                          }
                        }}
                        disabled={createProposalMutation.isPending || !selectedIssue?.decisionPacket || !hasAdminKey}
                        title={hasAdminKey ? undefined : tAdmin("required")}
                        className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {createProposalMutation.isPending ? (
                          <Loader2 className="w-4 h-4 mr-2 inline animate-spin" />
                        ) : (
                          <MessageSquare className="w-4 h-4 mr-2 inline" />
                        )}
                        {createProposalMutation.isPending ? t("proposals.creating") : t("issues.createProposal")}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="card text-center py-12 text-gray-500">
              <AlertTriangle className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p>{t("common.view")}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
