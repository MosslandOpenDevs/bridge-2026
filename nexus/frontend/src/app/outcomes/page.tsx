'use client';

import { ConnectButton } from '@rainbow-me/rainbowkit';
import Link from 'next/link';
import { OutcomeCard } from '@/components/outcome-card';
import { DemoModeBanner } from '@/components/demo-mode-banner';
import { useState, useEffect } from 'react';
import type { Outcome } from '@bridge-2026/shared';
import { api, isAbortError } from '@/lib/api';
import { DEMO_MODE, getDemoOutcomes } from '@/lib/demo-data';

export default function OutcomesPage() {
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'success' | 'failure'>('all');

  useEffect(() => {
    // 데모 모드에서는 백엔드를 호출하지 않습니다. 데모 데이터는 API 실패의
    // 대체물이 아니므로, 실패는 아래 catch에서 실패로 드러나야 합니다.
    if (DEMO_MODE) {
      setOutcomes(getDemoOutcomes());
      setError(null);
      setLoading(false);
      return;
    }

    // 상단 통계는 필터와 무관한 전체 집계이고, "실패" 탭은 failure와
    // partial_success를 함께 보여줍니다. 그래서 전체를 한 번 받아 아래에서
    // 걸러냅니다 — 서버에서 좁히면 통계까지 같이 좁혀집니다.
    const controller = new AbortController();

    setLoading(true);
    setError(null);

    api.getOutcomes({ limit: 100 }, { signal: controller.signal })
      .then(result => {
        setOutcomes(result.outcomes);
        setError(null);
      })
      .catch(err => {
        if (isAbortError(err)) return;
        console.error('Error fetching outcomes:', err);
        setOutcomes([]);
        setError('결과 목록을 불러오지 못했습니다.');
      })
      .finally(() => {
        // The abort already discarded the result; leaving `loading` alone keeps
        // the spinner up for the newer request that replaced this one.
        if (controller.signal.aborted) return;
        setLoading(false);
      });

    return () => controller.abort();
  }, []);


  const filteredOutcomes = outcomes.filter(o => {
    if (filter === 'all') return true;
    if (filter === 'success') return o.status === 'success';
    if (filter === 'failure') return o.status === 'failure' || o.status === 'partial_success';
    return true;
  });

  const successCount = outcomes.filter(o => o.status === 'success').length;
  const failureCount = outcomes.filter(o => o.status === 'failure' || o.status === 'partial_success').length;

  return (
    <main className="min-h-screen p-8 bg-gray-50">
      <div className="max-w-7xl mx-auto">
        <header className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-moss-600">Outcomes</h1>
            <p className="text-gray-600 mt-2">
              거버넌스 결정의 결과를 확인하고 평가합니다
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

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow-md p-4 border border-moss-200">
            <div className="text-2xl font-bold text-moss-600">{outcomes.length}</div>
            <div className="text-sm text-gray-600">총 결과</div>
          </div>
          <div className="bg-white rounded-lg shadow-md p-4 border border-green-200">
            <div className="text-2xl font-bold text-green-600">{successCount}</div>
            <div className="text-sm text-gray-600">성공</div>
          </div>
          <div className="bg-white rounded-lg shadow-md p-4 border border-red-200">
            <div className="text-2xl font-bold text-red-600">{failureCount}</div>
            <div className="text-sm text-gray-600">실패/부분 성공</div>
          </div>
        </div>

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
            onClick={() => setFilter('success')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              filter === 'success'
                ? 'bg-moss-600 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            성공
          </button>
          <button
            onClick={() => setFilter('failure')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              filter === 'failure'
                ? 'bg-moss-600 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            실패
          </button>
        </div>

        {/* Outcomes List */}
        {loading ? (
          <div className="text-center py-12">
            <p className="text-gray-600">로딩 중...</p>
          </div>
        ) : error ? (
          // 조회 실패를 "결과 없음"으로 보여주면 사용자가 잘못된 결론을 내립니다.
          <div className="bg-white rounded-lg shadow-md p-12 text-center border border-red-200">
            <p className="text-red-700 mb-4">{error}</p>
            <p className="text-sm text-gray-500">
              백엔드 API 연결을 확인한 뒤 다시 시도해주세요.
            </p>
          </div>
        ) : filteredOutcomes.length === 0 ? (
          <div className="bg-white rounded-lg shadow-md p-12 text-center">
            <p className="text-gray-600 mb-4">결과가 없습니다.</p>
            <p className="text-sm text-gray-500">
              거버넌스 결정의 결과가 평가되면 여기에 표시됩니다.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6">
            {filteredOutcomes.map(outcome => (
              <OutcomeCard key={outcome.id} outcome={outcome} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
