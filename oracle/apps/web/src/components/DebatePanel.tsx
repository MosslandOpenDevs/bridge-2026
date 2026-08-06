"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import {
  MessageCircle,
  Users,
  Shield,
  Coins,
  Code,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  CheckCircle,
  AlertTriangle,
  Loader2,
  TrendingUp,
  TrendingDown,
} from "lucide-react";

interface DiscussionMessage {
  id: string;
  roundNumber: number;
  speakerId: string;
  speakerRole: string;
  targetAgentRole?: string;
  messageType: "opinion" | "rebuttal" | "support" | "clarification" | "concession";
  content: string;
  keyPoints: string[];
  referencedPoints?: string[];
  timestamp: string;
}

interface DiscussionRound {
  roundNumber: number;
  topic: string;
  messages: DiscussionMessage[];
  consensusShift?: number;
  keyInsights: string[];
  unresolvedPoints: string[];
  startedAt: string;
  completedAt?: string;
}

interface PositionChange {
  agentId: string;
  agentRole: string;
  fromStance: string;
  toStance: string;
  reason: string;
  atRound: number;
}

interface DebateSession {
  id: string;
  issueId: string;
  status: "in_progress" | "completed" | "cancelled";
  rounds: DiscussionRound[];
  maxRounds: number;
  currentRound: number;
  initialOpinions: any[];
  finalConsensusScore?: number;
  positionChanges: PositionChange[];
  startedAt: string;
  completedAt?: string;
}

const roleIcons: Record<string, React.ElementType> = {
  risk: Shield,
  treasury: Coins,
  community: Users,
  product: Code,
};

const roleColors: Record<string, string> = {
  risk: "bg-red-100 text-red-700 border-red-200",
  treasury: "bg-yellow-100 text-yellow-700 border-yellow-200",
  community: "bg-blue-100 text-blue-700 border-blue-200",
  product: "bg-purple-100 text-purple-700 border-purple-200",
};

const messageTypeStyles: Record<string, { bg: string; icon: React.ElementType; label: string }> = {
  rebuttal: { bg: "bg-red-50 border-red-200", icon: AlertTriangle, label: "Rebuttal" },
  support: { bg: "bg-green-50 border-green-200", icon: CheckCircle, label: "Support" },
  clarification: { bg: "bg-blue-50 border-blue-200", icon: MessageCircle, label: "Clarification" },
  concession: { bg: "bg-yellow-50 border-yellow-200", icon: ArrowRight, label: "Concession" },
  opinion: { bg: "bg-gray-50 border-gray-200", icon: MessageCircle, label: "Opinion" },
};

const stanceLabels: Record<string, { text: string; color: string }> = {
  strongly_support: { text: "Strongly Support", color: "text-green-600" },
  support: { text: "Support", color: "text-green-500" },
  neutral: { text: "Neutral", color: "text-gray-500" },
  oppose: { text: "Oppose", color: "text-red-500" },
  strongly_oppose: { text: "Strongly Oppose", color: "text-red-600" },
};

interface DebatePanelProps {
  session: DebateSession;
  isLoading?: boolean;
  onComplete?: () => void;
}

export function DebatePanel({ session, isLoading }: DebatePanelProps) {
  const t = useTranslations();
  const [expandedRounds, setExpandedRounds] = useState<number[]>([]);

  // Auto-expand the latest round when it changes
  useEffect(() => {
    if (session.rounds.length > 0) {
      const latestRound = session.rounds[session.rounds.length - 1].roundNumber;
      if (!expandedRounds.includes(latestRound)) {
        setExpandedRounds([...expandedRounds, latestRound]);
      }
    }
  }, [session.rounds.length]);

  const toggleRound = (roundNumber: number) => {
    setExpandedRounds((prev) =>
      prev.includes(roundNumber)
        ? prev.filter((r) => r !== roundNumber)
        : [...prev, roundNumber]
    );
  };

  const getRoleLabel = (role: string) => {
    const labels: Record<string, string> = {
      risk: "Risk",
      treasury: t("delegation.treasury"),
      community: t("delegation.community"),
      product: "Product",
    };
    return labels[role] || role;
  };

  return (
    <div className="space-y-4">
      {/* Debate Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <MessageCircle className="w-5 h-5 text-moss-600" />
          <h3 className="font-semibold text-gray-900">
            {t("debate.title") || "Agent Debate"}
          </h3>
          <span
            className={cn(
              "px-2 py-0.5 rounded-full text-xs font-medium",
              session.status === "completed"
                ? "bg-green-100 text-green-700"
                : "bg-yellow-100 text-yellow-700"
            )}
          >
            {session.status === "completed"
              ? t("debate.completed") || "Completed"
              : t("debate.inProgress") || "In Progress"}
          </span>
        </div>
        <div className="text-sm text-gray-500">
          {t("debate.round") || "Round"} {session.currentRound}/{session.maxRounds}
        </div>
      </div>

      {/* Initial Opinions */}
      <div className="bg-gray-50 rounded-lg p-4">
        <h4 className="text-sm font-medium text-gray-600 mb-3">
          {t("debate.initialPositions") || "Initial Positions"}
        </h4>
        <div className="grid grid-cols-2 gap-2">
          {session.initialOpinions.map((opinion) => {
            const Icon = roleIcons[opinion.role] || Users;
            const stanceInfo = stanceLabels[opinion.stance] || {
              text: opinion.stance,
              color: "text-gray-500",
            };
            return (
              <div
                key={opinion.agentId}
                className={cn(
                  "flex items-center space-x-2 p-2 rounded-lg border",
                  roleColors[opinion.role] || "bg-gray-100 border-gray-200"
                )}
              >
                <Icon className="w-4 h-4" />
                <span className="text-sm font-medium">{getRoleLabel(opinion.role)}</span>
                <span className={cn("text-xs ml-auto", stanceInfo.color)}>
                  {stanceInfo.text}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Position Changes */}
      {session.positionChanges.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <h4 className="text-sm font-medium text-amber-700 mb-2 flex items-center space-x-1">
            <ArrowRight className="w-4 h-4" />
            <span>{t("debate.positionChanges") || "Position Changes"}</span>
          </h4>
          <div className="space-y-2">
            {session.positionChanges.map((change, idx) => (
              <div
                key={idx}
                className="flex items-center text-sm text-amber-800 bg-amber-100/50 rounded p-2"
              >
                <span className="font-medium">{getRoleLabel(change.agentRole)}</span>
                <span className="mx-2 text-gray-400">changed from</span>
                <span className={stanceLabels[change.fromStance]?.color || "text-gray-500"}>
                  {stanceLabels[change.fromStance]?.text || change.fromStance}
                </span>
                <ArrowRight className="w-3 h-3 mx-2" />
                <span className={stanceLabels[change.toStance]?.color || "text-gray-500"}>
                  {stanceLabels[change.toStance]?.text || change.toStance}
                </span>
                <span className="ml-auto text-xs text-amber-600">Round {change.atRound}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Discussion Rounds */}
      <div className="space-y-3">
        {session.rounds.map((round) => {
          const isExpanded = expandedRounds.includes(round.roundNumber);
          const consensusShiftIcon =
            round.consensusShift && round.consensusShift > 0.02
              ? TrendingUp
              : round.consensusShift && round.consensusShift < -0.02
              ? TrendingDown
              : null;

          return (
            <div
              key={round.roundNumber}
              className="border border-gray-200 rounded-lg overflow-hidden"
            >
              {/* Round Header */}
              <button
                onClick={() => toggleRound(round.roundNumber)}
                className="w-full flex items-center justify-between p-3 bg-gray-50 hover:bg-gray-100 transition-colors"
              >
                <div className="flex items-center space-x-3">
                  <span className="px-2 py-1 bg-moss-100 text-moss-700 rounded text-sm font-medium">
                    {t("debate.round") || "Round"} {round.roundNumber}
                  </span>
                  <span className="text-sm text-gray-600">{round.topic}</span>
                </div>
                <div className="flex items-center space-x-2">
                  {consensusShiftIcon && (
                    <span
                      className={cn(
                        "flex items-center text-xs",
                        round.consensusShift! > 0 ? "text-green-600" : "text-red-600"
                      )}
                    >
                      {consensusShiftIcon === TrendingUp ? (
                        <TrendingUp className="w-3 h-3 mr-1" />
                      ) : (
                        <TrendingDown className="w-3 h-3 mr-1" />
                      )}
                      {round.consensusShift! > 0 ? "+" : ""}
                      {(round.consensusShift! * 100).toFixed(0)}%
                    </span>
                  )}
                  <span className="text-xs text-gray-400">
                    {round.messages.length} {t("debate.messages") || "messages"}
                  </span>
                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4 text-gray-400" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-gray-400" />
                  )}
                </div>
              </button>

              {/* Round Content */}
              {isExpanded && (
                <div className="p-3 space-y-3">
                  {/* Messages */}
                  {round.messages.map((message) => {
                    const Icon = roleIcons[message.speakerRole] || Users;
                    const typeStyle = messageTypeStyles[message.messageType] || messageTypeStyles.opinion;
                    const TypeIcon = typeStyle.icon;

                    return (
                      <div
                        key={message.id}
                        className={cn(
                          "p-3 rounded-lg border",
                          typeStyle.bg
                        )}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center space-x-2">
                            <div
                              className={cn(
                                "p-1 rounded",
                                roleColors[message.speakerRole]?.split(" ")[0] || "bg-gray-100"
                              )}
                            >
                              <Icon className="w-4 h-4" />
                            </div>
                            <span className="font-medium text-sm">
                              {getRoleLabel(message.speakerRole)}
                            </span>
                            {message.targetAgentRole && (
                              <>
                                <ArrowRight className="w-3 h-3 text-gray-400" />
                                <span className="text-sm text-gray-500">
                                  {getRoleLabel(message.targetAgentRole)}
                                </span>
                              </>
                            )}
                          </div>
                          <span
                            className={cn(
                              "flex items-center space-x-1 px-2 py-0.5 rounded text-xs",
                              typeStyle.bg
                            )}
                          >
                            <TypeIcon className="w-3 h-3" />
                            <span>{typeStyle.label}</span>
                          </span>
                        </div>

                        <p className="text-sm text-gray-700">{message.content}</p>

                        {message.keyPoints.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {message.keyPoints.map((point, idx) => (
                              <span
                                key={idx}
                                className="px-2 py-0.5 bg-white/50 rounded text-xs text-gray-600"
                              >
                                {point}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Round Insights */}
                  {round.keyInsights.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-200">
                      <h5 className="text-xs font-medium text-gray-500 mb-2">
                        {t("debate.keyInsights") || "Key Insights"}
                      </h5>
                      <ul className="space-y-1">
                        {round.keyInsights.map((insight, idx) => (
                          <li key={idx} className="text-sm text-gray-600 flex items-start">
                            <CheckCircle className="w-3 h-3 mr-2 mt-0.5 text-moss-500 flex-shrink-0" />
                            {insight}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Unresolved Points */}
                  {round.unresolvedPoints.length > 0 && (
                    <div className="mt-2">
                      <h5 className="text-xs font-medium text-gray-500 mb-2">
                        {t("debate.unresolvedPoints") || "Unresolved Points"}
                      </h5>
                      <ul className="space-y-1">
                        {round.unresolvedPoints.map((point, idx) => (
                          <li key={idx} className="text-sm text-gray-600 flex items-start">
                            <AlertTriangle className="w-3 h-3 mr-2 mt-0.5 text-amber-500 flex-shrink-0" />
                            {point}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center py-4 text-gray-500">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          <span>{t("debate.processing") || "Agents are discussing..."}</span>
        </div>
      )}

      {/* Final Consensus */}
      {session.status === "completed" && session.finalConsensusScore !== undefined && (
        <div className="bg-moss-50 border border-moss-200 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="font-medium text-moss-800">
                {t("debate.finalConsensus") || "Final Consensus"}
              </h4>
              <p className="text-sm text-moss-600 mt-1">
                {t("debate.roundsCompleted") || "Rounds completed"}: {session.rounds.length}
                {" | "}
                {t("debate.positionChanges") || "Position changes"}: {session.positionChanges.length}
              </p>
            </div>
            <div className="text-right">
              <span className="text-3xl font-bold text-moss-700">
                {(session.finalConsensusScore * 100).toFixed(0)}%
              </span>
              <p className="text-xs text-moss-600">
                {session.finalConsensusScore >= 0.7
                  ? t("debate.highConsensus") || "High Consensus"
                  : session.finalConsensusScore >= 0.4
                  ? t("debate.moderateConsensus") || "Moderate Consensus"
                  : t("debate.lowConsensus") || "Low Consensus"}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
