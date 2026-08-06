'use client';

import { ConnectButton } from '@rainbow-me/rainbowkit';
import Link from 'next/link';
import { SignalCard } from '@/components/signal-card';
import { DemoModeBanner } from '@/components/demo-mode-banner';
import { useState, useEffect } from 'react';
import { SignalSource, type Signal } from '@bridge-2026/shared';
import { api, isAbortError } from '@/lib/api';
import { DEMO_MODE, getDemoSignals } from '@/lib/demo-data';

/** "anomaly" is a tag, not a source, so it can only be filtered client-side. */
type SignalFilter = 'all' | 'anomaly' | SignalSource.ONCHAIN | SignalSource.COMMUNITY;

export default function RealityFeedPage() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<SignalFilter>('all');

  useEffect(() => {
    // 데모 모드에서는 백엔드를 호출하지 않습니다. 데모 데이터는 API 실패의
    // 대체물이 아니므로, 실패는 아래 catch에서 실패로 드러나야 합니다.
    if (DEMO_MODE) {
      setSignals(getDemoSignals());
      setError(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();

    setLoading(true);
    setError(null);

    api.getSignals({ limit: 100 }, { signal: controller.signal })
      .then(result => {
        setSignals(result.signals);
        setError(null);
      })
      .catch(err => {
        if (isAbortError(err)) return;
        console.error('Error fetching signals:', err);
        setSignals([]);
        setError('신호를 불러오지 못했습니다.');
      })
      .finally(() => {
        // The abort already discarded the result; leaving `loading` alone keeps
        // the spinner up for the newer request that replaced this one.
        if (controller.signal.aborted) return;
        setLoading(false);
      });

    return () => controller.abort();
  }, []);


  const filteredSignals = signals.filter(s => {
    if (filter === 'all') return true;
    if (filter === 'anomaly') return s.metadata.tags?.includes('anomaly');
    return s.metadata.source === filter;
  });

  const anomalyCount = signals.filter(s => s.metadata.tags?.includes('anomaly')).length;

  return (
    <main className="min-h-screen p-8 bg-gray-50">
      <div className="max-w-7xl mx-auto">
        <header className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-moss-600">Reality Feed</h1>
            <p className="text-gray-600 mt-2">
              실세계 신호를 실시간으로 모니터링합니다
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
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow-md p-4 border border-moss-200">
            <div className="text-2xl font-bold text-moss-600">{signals.length}</div>
            <div className="text-sm text-gray-600">총 신호</div>
          </div>
          <div className="bg-white rounded-lg shadow-md p-4 border border-moss-200">
            <div className="text-2xl font-bold text-red-600">{anomalyCount}</div>
            <div className="text-sm text-gray-600">이상 징후</div>
          </div>
          <div className="bg-white rounded-lg shadow-md p-4 border border-moss-200">
            <div className="text-2xl font-bold text-blue-600">
              {signals.filter(s => s.metadata.source === SignalSource.ONCHAIN).length}
            </div>
            <div className="text-sm text-gray-600">온체인 신호</div>
          </div>
          <div className="bg-white rounded-lg shadow-md p-4 border border-moss-200">
            <div className="text-2xl font-bold text-green-600">
              {signals.filter(s => s.metadata.source === SignalSource.COMMUNITY).length}
            </div>
            <div className="text-sm text-gray-600">커뮤니티 신호</div>
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
            onClick={() => setFilter(SignalSource.ONCHAIN)}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              filter === SignalSource.ONCHAIN
                ? 'bg-moss-600 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            온체인
          </button>
          <button
            onClick={() => setFilter(SignalSource.COMMUNITY)}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              filter === SignalSource.COMMUNITY
                ? 'bg-moss-600 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            커뮤니티
          </button>
          <button
            onClick={() => setFilter('anomaly')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              filter === 'anomaly'
                ? 'bg-moss-600 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            이상 징후
          </button>
        </div>

        {/* Signals List */}
        {loading ? (
          <div className="text-center py-12">
            <p className="text-gray-600">로딩 중...</p>
          </div>
        ) : error ? (
          // 조회 실패를 "신호 없음"으로 보여주면 사용자가 잘못된 결론을 내립니다.
          <div className="bg-white rounded-lg shadow-md p-12 text-center border border-red-200">
            <p className="text-red-700 mb-4">{error}</p>
            <p className="text-sm text-gray-500">
              백엔드 API 연결을 확인한 뒤 다시 시도해주세요.
            </p>
          </div>
        ) : filteredSignals.length === 0 ? (
          <div className="bg-white rounded-lg shadow-md p-12 text-center">
            <p className="text-gray-600 mb-4">신호가 없습니다.</p>
            <p className="text-sm text-gray-500">
              새로운 신호가 수집되면 여기에 표시됩니다.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredSignals.map(signal => (
              <SignalCard key={signal.id} signal={signal} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
