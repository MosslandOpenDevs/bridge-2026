'use client';

import { Proposal } from '@bridge-2026/shared';
import Link from 'next/link';
import { formatDate, formatPercent } from '@bridge-2026/shared/utils';

interface ProposalCardProps {
  proposal: Proposal;
}

export function ProposalCard({ proposal }: ProposalCardProps) {
  const isActive = proposal.status === 'active';
  // `metadata` is an open `Record<string, unknown>`, so every read has to prove
  // the shape it wants before rendering it.
  const aiAssisted = proposal.metadata?.aiAssisted === true;
  const agentConfidence =
    typeof proposal.metadata?.agentConfidence === 'number'
      ? proposal.metadata.agentConfidence
      : undefined;

  return (
    <div className="bg-white rounded-lg shadow-md p-6 border border-moss-200 hover:shadow-lg transition-shadow">
      <div className="flex justify-between items-start mb-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <h3 className="text-xl font-semibold text-moss-700">
              {proposal.title}
            </h3>
            {aiAssisted && (
              <span className="px-2 py-1 text-xs font-medium bg-moss-100 text-moss-700 rounded">
                AI Assisted
              </span>
            )}
          </div>
          <p className="text-gray-600 text-sm mb-3 line-clamp-2">
            {proposal.description}
          </p>
        </div>
        <div className="ml-4">
          <StatusBadge status={proposal.status} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
        <div>
          <span className="text-gray-500">타입:</span>
          <span className="ml-2 text-moss-600 font-medium">
            {getTypeLabel(proposal.type)}
          </span>
        </div>
        <div>
          <span className="text-gray-500">생성일:</span>
          <span className="ml-2 text-gray-700">
            {formatDate(proposal.createdAt, 'short')}
          </span>
        </div>
        {proposal.votingEndTime && (
          <div>
            <span className="text-gray-500">투표 종료:</span>
            <span className="ml-2 text-gray-700">
              {formatDate(proposal.votingEndTime, 'short')}
            </span>
          </div>
        )}
        {proposal.minParticipationRate && (
          <div>
            <span className="text-gray-500">최소 참여율:</span>
            <span className="ml-2 text-gray-700">
              {formatPercent(proposal.minParticipationRate)}
            </span>
          </div>
        )}
      </div>

      {agentConfidence !== undefined && (
        <div className="mb-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">에이전트 신뢰도:</span>
            <div className="flex-1 bg-gray-200 rounded-full h-2">
              <div
                className="bg-moss-600 h-2 rounded-full"
                style={{
                  width: `${agentConfidence * 100}%`,
                }}
              />
            </div>
            <span className="text-sm text-moss-600 font-medium">
              {formatPercent(agentConfidence)}
            </span>
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <Link
          href={`/proposals/${proposal.id}`}
          className="flex-1 px-4 py-2 bg-moss-600 text-white rounded-lg hover:bg-moss-700 text-center font-medium transition-colors"
        >
          {isActive ? '투표하기' : '상세보기'}
        </Link>
        {isActive && (
          <button className="px-4 py-2 border border-moss-300 text-moss-600 rounded-lg hover:bg-moss-50 transition-colors">
            북마크
          </button>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const statusConfig: Record<string, { label: string; color: string }> = {
    pending: { label: '대기중', color: 'bg-gray-100 text-gray-700' },
    active: { label: '투표중', color: 'bg-blue-100 text-blue-700' },
    passed: { label: '통과', color: 'bg-green-100 text-green-700' },
    rejected: { label: '부결', color: 'bg-red-100 text-red-700' },
    executed: { label: '실행됨', color: 'bg-moss-100 text-moss-700' },
    cancelled: { label: '취소됨', color: 'bg-gray-100 text-gray-700' },
  };

  const config = statusConfig[status] || statusConfig.pending;

  return (
    <span className={`px-3 py-1 text-xs font-medium rounded-full ${config.color}`}>
      {config.label}
    </span>
  );
}

function getTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    governance: '거버넌스',
    treasury: '재무',
    technical: '기술',
    policy: '정책',
  };
  return labels[type] || type;
}









