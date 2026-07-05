'use client';

import { ConnectButton } from '@rainbow-me/rainbowkit';
import Link from 'next/link';
import { SignalCard } from '@/components/signal-card';
import { useState, useEffect } from 'react';
import type { Signal } from '@bridge-2026/shared';
import { api } from '@/lib/api';

export default function RealityFeedPage() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'onchain' | 'community' | 'anomaly'>('all');

  useEffect(() => {
    // API 호출
    api.getSignals({ limit: 100 })
      .then(result => setSignals(result.signals))
      .catch(error => {
        console.error('Error fetching signals:', error);
        // 에러 시 빈 배열
        setSignals([]);
      })
      .finally(() => setLoading(false));
    
    // 임시 데이터 (API 실패 시 fallback)
    const mockSignals: Signal[] = [
      {
        id: 'sig-1',
        metadata: {
          sourceType: 'onchain',
          timestamp: Date.now() - 1000 * 60 * 30,
          confidence: 0.95,
          tags: ['governance', 'proposal'],
        },
        data: {
          eventType: 'ProposalCreated',
          blockNumber: 18500000,
          transactionHash: '0x1234...',
        },
      },
      {
        id: 'sig-2',
        metadata: {
          sourceType: 'community',
          timestamp: Date.now() - 1000 * 60 * 60 * 2,
          confidence: 0.88,
          tags: ['checkin', 'proof-of-presence'],
        },
        data: {
          checkInType: 'qr',
          location: { name: '서울 이벤트장' },
          walletAddress: '0x5678...',
        },
      },
      {
        id: 'sig-3',
        metadata: {
          sourceType: 'onchain',
          timestamp: Date.now() - 1000 * 60 * 60 * 5,
          confidence: 0.92,
          tags: ['governance', 'anomaly'],
        },
        data: {
          eventType: 'ParticipationRateDrop',
          participationRate: 0.05,
        },
      },
      {
        id: 'sig-4',
        metadata: {
          sourceType: 'public_api',
          timestamp: Date.now() - 1000 * 60 * 60 * 12,
          confidence: 0.85,
          tags: ['weather', 'city-pulse'],
        },
        data: {
          source: 'weather',
          city: '서울',
          temperature: 22,
          humidity: 65,
        },
      },
      {
        id: 'sig-5',
        metadata: {
          sourceType: 'telemetry',
          timestamp: Date.now() - 1000 * 60 * 60 * 24,
          confidence: 0.90,
          tags: ['github', 'development'],
        },
        data: {
          source: 'github',
          type: 'pull_request',
          repository: 'mossland/bridge-2026',
          openPRs: 5,
        },
      },
    ];
    
    setTimeout(() => {
      setSignals(mockSignals);
      setLoading(false);
    }, 500);
  }, []);

  const filteredSignals = signals.filter(s => {
    if (filter === 'all') return true;
    if (filter === 'anomaly') return s.metadata.tags?.includes('anomaly');
    return s.metadata.sourceType === filter;
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
              {signals.filter(s => s.metadata.sourceType === 'onchain').length}
            </div>
            <div className="text-sm text-gray-600">온체인 신호</div>
          </div>
          <div className="bg-white rounded-lg shadow-md p-4 border border-moss-200">
            <div className="text-2xl font-bold text-green-600">
              {signals.filter(s => s.metadata.sourceType === 'community').length}
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
            onClick={() => setFilter('onchain')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              filter === 'onchain'
                ? 'bg-moss-600 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            온체인
          </button>
          <button
            onClick={() => setFilter('community')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              filter === 'community'
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
