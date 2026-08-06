'use client';

import { Proposal, DecisionPacket } from '@bridge-2026/shared';
import { formatDate, formatPercent } from '@bridge-2026/shared/utils';
import { useAccount, usePublicClient, useWalletClient } from 'wagmi';
import { useState } from 'react';
import { api } from '@/lib/api';
import { castVoteTransaction, waitForTransaction } from '@/lib/blockchain';

interface ProposalDetailProps {
  proposal: Proposal;
  decisionPacket?: DecisionPacket;
}

export function ProposalDetail({ proposal, decisionPacket }: ProposalDetailProps) {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const [voteChoice, setVoteChoice] = useState<'yes' | 'no' | 'abstain' | null>(null);
  const [isVoting, setIsVoting] = useState(false);

  const isActive = proposal.status === 'active';
  const canVote = isActive && isConnected && address;

  const handleVote = async (choice: 'yes' | 'no' | 'abstain') => {
    if (!canVote) return;
    
    setVoteChoice(choice);
    if (!address || !walletClient || !publicClient) {
      alert('지갑을 연결해주세요.');
      return;
    }

    setIsVoting(true);
    
    try {
      // 블록체인 트랜잭션 서명 및 전송 (선택적)
      let txHash: `0x${string}` | undefined;
      
      try {
        txHash = await castVoteTransaction(
          proposal.id,
          choice,
          walletClient,
          address as `0x${string}`
        );
        
        // 트랜잭션 확인 대기
        await waitForTransaction(txHash, publicClient);
      } catch (txError: any) {
        // 거버넌스 컨트랙트가 배포되지 않은 경우 API만 사용
        if (txError.message?.includes('not deployed')) {
          console.log('Governance contract not deployed, using API only');
        } else {
          console.error('Transaction error:', txError);
        }
      }

      // API 호출 (트랜잭션 해시 포함)
      const result = await api.castVote(proposal.id, {
        voterAddress: address,
        choice,
        txHash: txHash || undefined,
      });
      
      if (result.success) {
        alert(`투표가 완료되었습니다: ${choice === 'yes' ? '찬성' : choice === 'no' ? '반대' : '기권'}`);
        if (result.txHash || txHash) {
          console.log('Transaction hash:', result.txHash || txHash);
        }
      } else {
        alert('투표에 실패했습니다.');
      }
    } catch (error) {
      console.error('Vote error:', error);
      alert('투표 중 오류가 발생했습니다.');
    } finally {
      setIsVoting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="bg-white rounded-lg shadow-md p-6 mb-6">
        <div className="flex justify-between items-start mb-4">
          <div className="flex-1">
            <h1 className="text-3xl font-bold text-moss-700 mb-2">
              {proposal.title}
            </h1>
            <div className="flex items-center gap-3 text-sm text-gray-600">
              <span>타입: {getTypeLabel(proposal.type)}</span>
              <span>•</span>
              <span>생성일: {formatDate(proposal.createdAt, 'long')}</span>
            </div>
          </div>
          <StatusBadge status={proposal.status} />
        </div>

        <div className="prose max-w-none">
          <p className="text-gray-700 whitespace-pre-line">
            {proposal.description}
          </p>
        </div>
      </div>

      {/* Decision Packet */}
      {decisionPacket && (
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-2xl font-semibold text-moss-700 mb-4">
            AI 에이전트 분석
          </h2>
          
          <div className="mb-6">
            <h3 className="text-lg font-semibold mb-2">주요 추천</h3>
            <p className="text-gray-700 mb-4">{decisionPacket.recommendation}</p>
            
            {decisionPacket.recommendationDetails && (
              <div className="bg-moss-50 p-4 rounded-lg">
                <p className="text-gray-700 whitespace-pre-line">
                  {decisionPacket.recommendationDetails}
                </p>
              </div>
            )}
          </div>

          {decisionPacket.risks && decisionPacket.risks.length > 0 && (
            <div className="mb-6">
              <h3 className="text-lg font-semibold mb-2">위험 평가</h3>
              <ul className="space-y-2">
                {decisionPacket.risks.map((risk, index) => (
                  <li key={index} className="flex items-start gap-2">
                    <span className="text-red-500 mt-1">⚠️</span>
                    <div>
                      <p className="font-medium text-gray-700">{risk.title}</p>
                      {risk.description && (
                        <p className="text-sm text-gray-600">{risk.description}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {decisionPacket.alternatives && decisionPacket.alternatives.length > 0 && (
            <div className="mb-6">
              <h3 className="text-lg font-semibold mb-2">대안</h3>
              <ul className="space-y-2">
                {decisionPacket.alternatives.map((alt, index) => (
                  <li key={index} className="flex items-start gap-2">
                    <span className="text-moss-500 mt-1">•</span>
                    <div>
                      <p className="font-medium text-gray-700">{alt.title}</p>
                      {alt.description && (
                        <p className="text-sm text-gray-600">{alt.description}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-center gap-4 pt-4 border-t">
            <div>
              <span className="text-sm text-gray-500">에이전트 신뢰도:</span>
              <span className="ml-2 text-moss-600 font-semibold">
                {formatPercent(decisionPacket.overallConfidence)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Voting Section */}
      {isActive && (
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-2xl font-semibold text-moss-700 mb-4">
            투표하기
          </h2>

          {!isConnected ? (
            <div className="text-center py-8">
              <p className="text-gray-600 mb-4">
                투표하려면 지갑을 연결해주세요.
              </p>
              <button className="px-6 py-3 bg-moss-600 text-white rounded-lg hover:bg-moss-700 font-medium">
                지갑 연결
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <button
                  onClick={() => handleVote('yes')}
                  disabled={isVoting}
                  className={`px-6 py-4 rounded-lg font-medium transition-colors ${
                    voteChoice === 'yes'
                      ? 'bg-green-600 text-white'
                      : 'bg-green-50 text-green-700 hover:bg-green-100 border-2 border-green-300'
                  } disabled:opacity-50`}
                >
                  👍 찬성
                </button>
                <button
                  onClick={() => handleVote('no')}
                  disabled={isVoting}
                  className={`px-6 py-4 rounded-lg font-medium transition-colors ${
                    voteChoice === 'no'
                      ? 'bg-red-600 text-white'
                      : 'bg-red-50 text-red-700 hover:bg-red-100 border-2 border-red-300'
                  } disabled:opacity-50`}
                >
                  👎 반대
                </button>
                <button
                  onClick={() => handleVote('abstain')}
                  disabled={isVoting}
                  className={`px-6 py-4 rounded-lg font-medium transition-colors ${
                    voteChoice === 'abstain'
                      ? 'bg-gray-600 text-white'
                      : 'bg-gray-50 text-gray-700 hover:bg-gray-100 border-2 border-gray-300'
                  } disabled:opacity-50`}
                >
                  🤷 기권
                </button>
              </div>

              {isVoting && (
                <p className="text-center text-gray-600">투표 처리 중...</p>
              )}

              <div className="pt-4 border-t text-sm text-gray-600">
                <p>• 투표는 되돌릴 수 없습니다.</p>
                <p>• 투표 가중치는 보유한 Moss Coin 수량에 비례합니다.</p>
                {proposal.votingEndTime && (
                  <p>
                    • 투표 종료: {formatDate(proposal.votingEndTime, 'long')}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Voting Info */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-2xl font-semibold text-moss-700 mb-4">
          투표 정보
        </h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-gray-500">최소 참여율:</span>
            <span className="ml-2 font-medium">
              {proposal.minParticipationRate
                ? formatPercent(proposal.minParticipationRate)
                : 'N/A'}
            </span>
          </div>
          <div>
            <span className="text-gray-500">통과 기준:</span>
            <span className="ml-2 font-medium">
              {proposal.passingThreshold
                ? formatPercent(proposal.passingThreshold)
                : 'N/A'}
            </span>
          </div>
        </div>
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

