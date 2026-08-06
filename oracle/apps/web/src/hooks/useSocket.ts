"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { io, Socket } from "socket.io-client";

// 빈 문자열이면 현재 도메인 사용 (상대 경로)
const SOCKET_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

// The event payloads come from @oracle/core, which the API emits against, so
// the two cannot drift apart unnoticed. They used to be declared separately
// here and had: the server sent a round object where this expected a number,
// and finalConsensusScore where this read consensusScore (rendering NaN).
import {
  SOCKET_EVENTS,
  type StatsUpdateEvent,
  type SignalsCollectedEvent,
  type IssuesDetectedEvent,
  type ProposalCreatedEvent,
  type ProposalVotedEvent,
  type ProposalFinalizedEvent,
} from "@oracle/core";

export type {
  SignalsCollectedEvent,
  IssuesDetectedEvent,
  ProposalCreatedEvent,
  ProposalVotedEvent,
  ProposalFinalizedEvent,
};
export type SocketStats = StatsUpdateEvent;

type SocketEventHandler<T> = (data: T) => void;

export function useSocket() {
  const [isConnected, setIsConnected] = useState(false);
  const [stats, setStats] = useState<SocketStats | null>(null);
  const socketRef = useRef<Socket | null>(null);

  // Event handlers storage
  const handlersRef = useRef<{
    signalsCollected: SocketEventHandler<SignalsCollectedEvent>[];
    issuesDetected: SocketEventHandler<IssuesDetectedEvent>[];
    proposalCreated: SocketEventHandler<ProposalCreatedEvent>[];
    proposalVoted: SocketEventHandler<ProposalVotedEvent>[];
    proposalFinalized: SocketEventHandler<ProposalFinalizedEvent>[];
  }>({
    signalsCollected: [],
    issuesDetected: [],
    proposalCreated: [],
    proposalVoted: [],
    proposalFinalized: [],
  });

  useEffect(() => {
    // Initialize socket connection
    const socket = io(SOCKET_URL, {
      transports: ["websocket", "polling"],
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      console.log("🔌 Socket connected:", socket.id);
      setIsConnected(true);
    });

    socket.on("disconnect", () => {
      console.log("🔌 Socket disconnected");
      setIsConnected(false);
    });

    socket.on("connect_error", (error) => {
      console.error("🔌 Socket connection error:", error);
    });

    // Stats update on connection
    socket.on(SOCKET_EVENTS.statsUpdate, (data: SocketStats) => {
      setStats(data);
    });

    // Signal events
    socket.on(SOCKET_EVENTS.signalsCollected, (data: SignalsCollectedEvent) => {
      setStats((prev) => prev ? { ...prev, signals: data.total } : prev);
      handlersRef.current.signalsCollected.forEach((handler) => handler(data));
    });

    // Issue events
    socket.on(SOCKET_EVENTS.issuesDetected, (data: IssuesDetectedEvent) => {
      setStats((prev) => prev ? { ...prev, issues: data.totalCount } : prev);
      handlersRef.current.issuesDetected.forEach((handler) => handler(data));
    });

    // Proposal events
    socket.on(SOCKET_EVENTS.proposalCreated, (data: ProposalCreatedEvent) => {
      setStats((prev) => prev ? {
        ...prev,
        proposals: data.totalCount,
        activeProposals: data.activeCount,
      } : prev);
      handlersRef.current.proposalCreated.forEach((handler) => handler(data));
    });

    // Vote events
    socket.on(SOCKET_EVENTS.proposalVoted, (data: ProposalVotedEvent) => {
      handlersRef.current.proposalVoted.forEach((handler) => handler(data));
    });

    // Finalization: voting closed and the proposal passed or was rejected.
    socket.on(SOCKET_EVENTS.proposalFinalized, (data: ProposalFinalizedEvent) => {
      setStats((prev) => prev ? {
        ...prev,
        proposals: data.totalCount,
        activeProposals: data.activeCount,
      } : prev);
      handlersRef.current.proposalFinalized.forEach((handler) => handler(data));
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  // Subscribe to signal collection events
  const onSignalsCollected = useCallback((handler: SocketEventHandler<SignalsCollectedEvent>) => {
    handlersRef.current.signalsCollected.push(handler);
    return () => {
      handlersRef.current.signalsCollected = handlersRef.current.signalsCollected.filter(
        (h) => h !== handler
      );
    };
  }, []);

  // Subscribe to issue detection events
  const onIssuesDetected = useCallback((handler: SocketEventHandler<IssuesDetectedEvent>) => {
    handlersRef.current.issuesDetected.push(handler);
    return () => {
      handlersRef.current.issuesDetected = handlersRef.current.issuesDetected.filter(
        (h) => h !== handler
      );
    };
  }, []);

  // Subscribe to proposal creation events
  const onProposalCreated = useCallback((handler: SocketEventHandler<ProposalCreatedEvent>) => {
    handlersRef.current.proposalCreated.push(handler);
    return () => {
      handlersRef.current.proposalCreated = handlersRef.current.proposalCreated.filter(
        (h) => h !== handler
      );
    };
  }, []);

  // Subscribe to vote events
  const onProposalVoted = useCallback((handler: SocketEventHandler<ProposalVotedEvent>) => {
    handlersRef.current.proposalVoted.push(handler);
    return () => {
      handlersRef.current.proposalVoted = handlersRef.current.proposalVoted.filter(
        (h) => h !== handler
      );
    };
  }, []);

  // Subscribe to finalization events
  const onProposalFinalized = useCallback(
    (handler: SocketEventHandler<ProposalFinalizedEvent>) => {
      handlersRef.current.proposalFinalized.push(handler);
      return () => {
        handlersRef.current.proposalFinalized =
          handlersRef.current.proposalFinalized.filter((h) => h !== handler);
      };
    },
    [],
  );

  return {
    isConnected,
    stats,
    socket: socketRef.current,
    onSignalsCollected,
    onIssuesDetected,
    onProposalCreated,
    onProposalVoted,
    onProposalFinalized,
  };
}
