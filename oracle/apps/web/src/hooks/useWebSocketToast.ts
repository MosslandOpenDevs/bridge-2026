"use client";

import { useEffect } from "react";
import { useSocketContext } from "@/contexts/SocketContext";
import { useToast } from "@/contexts/ToastContext";
import { useTranslations } from "next-intl";
import {
  SOCKET_EVENTS,
  type DebateRoundCompletedEvent,
  type DebateCompletedEvent,
} from "@oracle/core";

export function useWebSocketToast() {
  const { isConnected, onSignalsCollected, onIssuesDetected, onProposalCreated, onProposalVoted, socket } = useSocketContext();
  const toast = useToast();
  const t = useTranslations("toast");

  useEffect(() => {
    // 연결 상태 변경 알림
    if (isConnected) {
      toast.success(t("connected.title"), t("connected.message"), {
        category: "system",
        duration: 3000,
      });
    }
  }, [isConnected]);

  useEffect(() => {
    // 신호 수집 알림
    const unsubSignals = onSignalsCollected((data) => {
      if (data.count > 0) {
        toast.info(
          t("signalsCollected.title"),
          t("signalsCollected.message", { count: data.count }),
          {
            category: "signal",
            duration: 4000,
          }
        );
      }
    });

    // 이슈 탐지 알림
    const unsubIssues = onIssuesDetected((data) => {
      if (data.newCount > 0) {
        // Issues carry `priority`, not `severity`. Reading a field that does
        // not exist meant every batch fell back to "medium", so an urgent
        // issue never raised anything louder than an info toast.
        const priority = data.issues[0]?.priority || "medium";
        const toastType =
          priority === "urgent" ? "error" : priority === "high" ? "warning" : "info";

        if (toastType === "error") {
          toast.error(
            t("issuesDetected.title"),
            t("issuesDetected.message", { count: data.newCount }),
            {
              category: "issue",
              duration: 6000,
            }
          );
        } else if (toastType === "warning") {
          toast.warning(
            t("issuesDetected.title"),
            t("issuesDetected.message", { count: data.newCount }),
            {
              category: "issue",
              duration: 5000,
            }
          );
        } else {
          toast.info(
            t("issuesDetected.title"),
            t("issuesDetected.message", { count: data.newCount }),
            {
              category: "issue",
              duration: 4000,
            }
          );
        }
      }
    });

    // 제안 생성 알림
    const unsubProposalCreated = onProposalCreated((data) => {
      toast.success(
        t("proposalCreated.title"),
        t("proposalCreated.message", { title: data.proposal.title }),
        {
          category: "proposal",
          duration: 5000,
        }
      );
    });

    // 투표 알림
    const unsubProposalVoted = onProposalVoted((data) => {
      const voter = data.vote?.voter || "Unknown";
      toast.info(
        t("proposalVoted.title"),
        t("proposalVoted.message", {
          voter: voter.length > 10 ? `${voter.slice(0, 6)}...${voter.slice(-4)}` : voter,
          vote: data.vote.choice,
        }),
        {
          category: "vote",
          duration: 4000,
        }
      );
    });

    return () => {
      unsubSignals();
      unsubIssues();
      unsubProposalCreated();
      unsubProposalVoted();
    };
  }, [onSignalsCollected, onIssuesDetected, onProposalCreated, onProposalVoted, toast, t]);

  // 토론 이벤트 리스너 추가
  useEffect(() => {
    if (!socket) return;

    const handleDebateRoundCompleted = (data: DebateRoundCompletedEvent) => {
      toast.info(
        t("debateRoundCompleted.title"),
        t("debateRoundCompleted.message", { round: data.round, total: data.totalRounds }),
        {
          category: "debate",
          duration: 4000,
        }
      );
    };

    const handleDebateCompleted = (data: DebateCompletedEvent) => {
      const score = Math.round(data.consensusScore * 100);
      toast.success(
        t("debateCompleted.title"),
        t("debateCompleted.message", { score }),
        {
          category: "debate",
          duration: 5000,
        }
      );
    };

    socket.on(SOCKET_EVENTS.debateRoundCompleted, handleDebateRoundCompleted);
    socket.on(SOCKET_EVENTS.debateCompleted, handleDebateCompleted);

    return () => {
      socket.off(SOCKET_EVENTS.debateRoundCompleted, handleDebateRoundCompleted);
      socket.off(SOCKET_EVENTS.debateCompleted, handleDebateCompleted);
    };
  }, [socket, toast, t]);

  return { isConnected };
}
