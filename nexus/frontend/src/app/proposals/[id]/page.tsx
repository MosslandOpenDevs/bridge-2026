'use client';

import { ConnectButton } from '@rainbow-me/rainbowkit';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ProposalDetail } from '@/components/proposal-detail';
import { DemoModeBanner } from '@/components/demo-mode-banner';
import { useState, useEffect } from 'react';
import type { Proposal, DecisionPacket } from '@bridge-2026/shared';
import { api, isAbortError } from '@/lib/api';
import {
  DEMO_MODE,
  getDemoDecisionPacket,
  getDemoProposal,
} from '@/lib/demo-data';

export default function ProposalDetailPage() {
  const params = useParams();
  const proposalId = params.id as string;
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [decisionPacket, setDecisionPacket] = useState<DecisionPacket | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // 데모 모드에서는 백엔드를 호출하지 않습니다. 데모 데이터는 API 실패의
    // 대체물이 아니므로, 실패는 아래 catch에서 실패로 드러나야 합니다.
    if (DEMO_MODE) {
      setProposal(getDemoProposal(proposalId));
      setDecisionPacket(getDemoDecisionPacket());
      setError(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();

    setLoading(true);
    setError(null);

    api.getProposal(proposalId, { signal: controller.signal })
      .then(proposalData => {
        setProposal(proposalData);
        // Decision Packet 전용 엔드포인트가 아직 없어 표시하지 않습니다.
        setDecisionPacket(null);
        setError(null);
      })
      .catch(err => {
        if (isAbortError(err)) return;
        console.error('Error fetching proposal:', err);
        setProposal(null);
        setDecisionPacket(null);
        setError('제안을 불러오지 못했습니다.');
      })
      .finally(() => {
        // The abort already discarded the result; leaving `loading` alone keeps
        // the spinner up for the newer request that replaced this one.
        if (controller.signal.aborted) return;
        setLoading(false);
      });

    return () => controller.abort();
  }, [proposalId]);

  if (loading) {
    return (
      <main className="min-h-screen p-8">
        <div className="max-w-7xl mx-auto text-center py-12">
          <p className="text-gray-600">로딩 중...</p>
        </div>
      </main>
    );
  }

  if (!proposal) {
    return (
      <main className="min-h-screen p-8">
        <div className="max-w-7xl mx-auto">
          <div className="bg-white rounded-lg shadow-md p-12 text-center">
            {/* 조회 실패와 "없는 제안"은 사용자에게 다른 의미입니다. */}
            <p className="text-gray-600 mb-4">
              {error ?? '제안을 찾을 수 없습니다.'}
            </p>
            <Link
              href="/proposals"
              className="text-moss-600 hover:text-moss-700 font-medium"
            >
              제안 목록으로 돌아가기
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-8 bg-gray-50">
      <div className="max-w-7xl mx-auto">
        <header className="flex justify-between items-center mb-8">
          <Link
            href="/proposals"
            className="px-4 py-2 text-moss-600 hover:text-moss-700"
          >
            ← 제안 목록
          </Link>
          <ConnectButton />
        </header>

        {DEMO_MODE && <DemoModeBanner />}

        <ProposalDetail proposal={proposal} decisionPacket={decisionPacket || undefined} />
      </div>
    </main>
  );
}

