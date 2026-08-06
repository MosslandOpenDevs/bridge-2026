'use client';

import { ConnectButton } from '@rainbow-me/rainbowkit';
import Link from 'next/link';
import { ProposalCard } from '@/components/proposal-card';
import { DemoModeBanner } from '@/components/demo-mode-banner';
import { useState, useEffect } from 'react';
import type { Proposal } from '@bridge-2026/shared';
import { api, isAbortError } from '@/lib/api';
import { DEMO_MODE, getDemoProposals } from '@/lib/demo-data';

export default function ProposalsPage() {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'active' | 'passed' | 'rejected'>('all');

  useEffect(() => {
    // 데모 모드에서는 백엔드를 호출하지 않습니다. 데모 데이터는 API 실패의
    // 대체물이 아니므로, 실패는 아래 catch에서 실패로 드러나야 합니다.
    if (DEMO_MODE) {
      setProposals(getDemoProposals());
      setError(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();

    setLoading(true);
    setError(null);

    api.getProposals(
      { status: filter === 'all' ? '' : filter, limit: 100 },
      { signal: controller.signal }
    )
      .then(result => {
        setProposals(result.proposals);
        setError(null);
      })
      .catch(err => {
        if (isAbortError(err)) return;
        console.error('Error fetching proposals:', err);
        setProposals([]);
        setError('제안 목록을 불러오지 못했습니다.');
      })
      .finally(() => {
        // The abort already discarded the result; leaving `loading` alone keeps
        // the spinner up for the newer request that replaced this one.
        if (controller.signal.aborted) return;
        setLoading(false);
      });

    return () => controller.abort();
  }, [filter]);


  const filteredProposals = proposals.filter(p => {
    if (filter === 'all') return true;
    return p.status === filter;
  });

  return (
    <main className="min-h-screen p-8 bg-gray-50">
      <div className="max-w-7xl mx-auto">
        <header className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-moss-600">Proposals</h1>
            <p className="text-gray-600 mt-2">
              AI Assisted Proposal을 검토하고 투표하세요
            </p>
          </div>
          <div className="flex gap-4">
            <Link
              href="/"
              className="px-4 py-2 text-moss-600 hover:text-moss-700"
            >
              ← 홈
            </Link>
            <ConnectButton />
          </div>
        </header>

        {DEMO_MODE && <DemoModeBanner />}

        {/* Filters */}
        <div className="mb-6 flex gap-2">
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              filter === 'all'
                ? 'bg-moss-600 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            전체
          </button>
          <button
            onClick={() => setFilter('active')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              filter === 'active'
                ? 'bg-moss-600 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            투표중
          </button>
          <button
            onClick={() => setFilter('passed')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              filter === 'passed'
                ? 'bg-moss-600 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            통과
          </button>
          <button
            onClick={() => setFilter('rejected')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              filter === 'rejected'
                ? 'bg-moss-600 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            부결
          </button>
        </div>

        {/* Proposals List */}
        {loading ? (
          <div className="text-center py-12">
            <p className="text-gray-600">로딩 중...</p>
          </div>
        ) : error ? (
          // 조회 실패를 "제안 없음"으로 보여주면 사용자가 잘못된 결론을 내립니다.
          <div className="bg-white rounded-lg shadow-md p-12 text-center border border-red-200">
            <p className="text-red-700 mb-4">{error}</p>
            <p className="text-sm text-gray-500">
              백엔드 API 연결을 확인한 뒤 다시 시도해주세요.
            </p>
          </div>
        ) : filteredProposals.length === 0 ? (
          <div className="bg-white rounded-lg shadow-md p-12 text-center">
            <p className="text-gray-600 mb-4">제안이 없습니다.</p>
            <p className="text-sm text-gray-500">
              새로운 제안이 생성되면 여기에 표시됩니다.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6">
            {filteredProposals.map(proposal => (
              <ProposalCard key={proposal.id} proposal={proposal} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
