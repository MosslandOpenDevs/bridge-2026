'use client';

import { Signal, SignalSource } from '@bridge-2026/shared';
import { formatDate, formatRelativeTime } from '@bridge-2026/shared/utils';

interface SignalCardProps {
  signal: Signal;
}

export function SignalCard({ signal }: SignalCardProps) {
  const source = signal.metadata.source;
  const confidence = signal.metadata.confidence || 0;
  const isAnomaly = signal.metadata.tags?.includes('anomaly');

  return (
    <div
      className={`bg-white rounded-lg shadow-md p-4 border ${
        isAnomaly
          ? 'border-red-300 bg-red-50'
          : 'border-moss-200 hover:shadow-lg transition-shadow'
      }`}
    >
      <div className="flex justify-between items-start mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <SourceBadge source={source} />
            {isAnomaly && (
              <span className="px-2 py-1 text-xs font-medium bg-red-100 text-red-700 rounded">
                이상 징후
              </span>
            )}
          </div>
          <h3 className="text-lg font-semibold text-moss-700 mb-1">
            {getSignalTitle(signal)}
          </h3>
          <p className="text-sm text-gray-600 line-clamp-2">
            {getSignalDescription(signal)}
          </p>
        </div>
        <div className="ml-4 text-right">
          <div className="text-xs text-gray-500 mb-1">
            {formatRelativeTime(new Date(signal.metadata.timestamp))}
          </div>
          <div className="flex items-center gap-1">
            <div className="w-16 bg-gray-200 rounded-full h-1.5">
              <div
                className={`h-1.5 rounded-full ${
                  confidence > 0.7 ? 'bg-green-500' : confidence > 0.4 ? 'bg-yellow-500' : 'bg-red-500'
                }`}
                style={{ width: `${confidence * 100}%` }}
              />
            </div>
            <span className="text-xs text-gray-600 ml-1">
              {Math.round(confidence * 100)}%
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mt-3">
        {signal.metadata.tags?.map(tag => (
          <span
            key={tag}
            className="px-2 py-1 text-xs bg-moss-100 text-moss-700 rounded"
          >
            {tag}
          </span>
        ))}
      </div>
    </div>
  );
}

function SourceBadge({ source }: { source: SignalSource }) {
  // Keyed by SignalSource so a new collector source shows up as a missing key
  // here rather than silently rendering the raw enum value.
  const sourceConfig: Record<string, { label: string; color: string }> = {
    [SignalSource.ONCHAIN]: { label: '온체인', color: 'bg-blue-100 text-blue-700' },
    [SignalSource.COMMUNITY]: { label: '커뮤니티', color: 'bg-green-100 text-green-700' },
    [SignalSource.PUBLIC_DATA]: { label: '공개 데이터', color: 'bg-purple-100 text-purple-700' },
    [SignalSource.TELEMETRY]: { label: '텔레메트리', color: 'bg-orange-100 text-orange-700' },
  };

  const config = sourceConfig[source] || {
    label: source ?? 'unknown',
    color: 'bg-gray-100 text-gray-700',
  };

  return (
    <span className={`px-2 py-1 text-xs font-medium rounded ${config.color}`}>
      {config.label}
    </span>
  );
}

/**
 * `Signal.data` is `Record<string, unknown>` by contract — its shape depends on
 * the collector, so every reader narrows just the field it needs instead of
 * asserting a shape the payload may not have.
 */
function readLocationName(data: Record<string, unknown>): string | undefined {
  const location = data.location;
  if (typeof location !== 'object' || location === null) return undefined;
  const name = (location as { name?: unknown }).name;
  return typeof name === 'string' ? name : undefined;
}

function getSignalTitle(signal: Signal): string {
  const data = signal.data as Record<string, unknown>;
  
  if (data.eventType) {
    return `${data.eventType} 이벤트`;
  }
  if (data.checkInType) {
    return `체크인: ${readLocationName(data) || '위치 정보 없음'}`;
  }
  if (data.source === 'weather') {
    return `날씨 정보: ${data.city || '도시'}`;
  }
  if (data.source === 'github') {
    return `GitHub: ${data.repository || '리포지토리'}`;
  }
  
  return '신호';
}

function getSignalDescription(signal: Signal): string {
  const data = signal.data as Record<string, unknown>;
  
  if (data.eventType === 'ProposalCreated') {
    return `새로운 제안이 생성되었습니다.`;
  }
  if (data.eventType === 'VoteCast') {
    return `투표가 진행되었습니다.`;
  }
  if (data.checkInType) {
    return `체크인 완료: ${readLocationName(data) || ''}`;
  }
  if (data.source === 'weather') {
    return `온도: ${data.temperature}°C, 습도: ${data.humidity}%`;
  }
  if (data.source === 'github') {
    return `${data.type}: ${data.openPRs || data.openIssues || 0}개`;
  }
  
  return '신호 데이터';
}









