/**
 * Governance Loop Integration
 * 
 * 전체 거버넌스 루프를 통합하는 예제입니다.
 * 
 * Reality Oracle → Inference Mining → Agentic Consensus → Human Governance → Atomic Actuation → Proof of Outcome
 */

import { execFile } from 'node:child_process';
import * as path from 'node:path';

import { realityOracle, OnChainCollector, CheckInCollector } from '@bridge-2026/reality-oracle';
import { agenticConsensus } from '@bridge-2026/agentic-consensus';
import { governanceService, agoraIntegration } from '@bridge-2026/human-governance';
import { atomicActuation } from '@bridge-2026/atomic-actuation';
import { proofOfOutcome } from '@bridge-2026/proof-of-outcome';
import type { Signal, Issue } from '@bridge-2026/shared';

/**
 * Inference Mining 레이어는 Python(numpy)으로 구현되어 있어 이 프로세스 안에서
 * 직접 부를 수 없다. `nexus/inference-mining/src/cli.py`가 stdin/stdout JSON
 * 프로토콜로 그 경계를 담당한다.
 *
 * 사전 준비: `cd nexus/inference-mining && pip install -r requirements.txt`
 * 인터프리터 경로는 PYTHON_BIN으로 바꿀 수 있다 (venv를 쓰는 경우).
 */
const INFERENCE_MINING_DIR = path.resolve(__dirname, '../inference-mining');

async function callInferenceMining<T>(command: string, request: unknown): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const child = execFile(
      process.env.PYTHON_BIN || 'python3',
      ['-m', 'src.cli', command],
      { cwd: INFERENCE_MINING_DIR },
      (error, stdout, stderr) => {
        if (error) {
          // CLI는 실패를 stderr JSON + 0이 아닌 종료 코드로 알린다.
          reject(new Error(`inference-mining ${command} 실패: ${stderr.trim() || error.message}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout) as T);
        } catch {
          reject(new Error(`inference-mining ${command} 응답이 JSON이 아님: ${stdout}`));
        }
      },
    );
    child.stdin?.end(JSON.stringify(request));
  });
}

/**
 * `src/cli.py extract-issue`의 응답 형태.
 *
 * Python 쪽이 이미 camelCase 키를 내보내므로 Issue와 필드가 1:1로 대응하지만,
 * 프로세스 경계를 넘어온 JSON은 검증되지 않았으므로 유니온 타입 대신 string으로
 * 받아 두고 아래에서 Issue로 옮긴다.
 */
interface ExtractedIssue {
  id: string;
  title: string;
  description: string;
  priority: string;
  status: string;
  evidence: Issue['evidence'];
  categories?: string[];
  detectedAt: number;
  updatedAt: number;
}

/**
 * 전체 거버넌스 루프 실행 예제
 */
export async function runGovernanceLoop(): Promise<void> {
  console.log('=== BRIDGE 2026 Governance Loop ===\n');
  
  // 1. Reality Oracle: 신호 수집
  console.log('1. Reality Oracle: 신호 수집 중...');
  const onchainCollector = new OnChainCollector({
    rpcUrl: process.env.RPC_URL || 'https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY',
  });
  realityOracle.registerCollector(onchainCollector);
  
  const checkinCollector = new CheckInCollector();
  realityOracle.registerCollector(checkinCollector);
  
  await realityOracle.startCollectors(60000);
  
  // 신호 수집 (예시)
  const signals: Signal[] = []; // 실제로는 수집기에서 수집됨
  console.log(`   수집된 신호: ${signals.length}개\n`);
  
  // 2. Inference Mining: 이슈 추출 (Python 프로세스 호출)
  console.log('2. Inference Mining: 이슈 추출 중...');
  const signalData = signals.map(s => ({
    id: s.id,
    data: s.data,
    metadata: s.metadata,
  }));

  const issue = await callInferenceMining<ExtractedIssue>('extract-issue', {
    signalData,
    issueTitle: '거버넌스 참여율 감소',
    issueDescription: '최근 거버넌스 참여율이 지속적으로 감소하고 있습니다.',
    priority: 'high',
  });

  console.log(`   추출된 이슈: ${issue.title}\n`);

  // 3. Agentic Consensus: 에이전트 협의
  console.log('3. Agentic Consensus: 에이전트 협의 중...');
  const issueTS: Issue = {
    id: issue.id,
    title: issue.title,
    description: issue.description,
    priority: issue.priority as Issue['priority'],
    status: issue.status as Issue['status'],
    evidence: issue.evidence,
    categories: issue.categories ?? [],
    detectedAt: issue.detectedAt,
    updatedAt: issue.updatedAt,
  };

  const decisionPacket = await agenticConsensus.processIssue(issueTS, {
    availableBudget: 1000000,
    sentiment: 'neutral',
  });
  
  console.log(`   Decision Packet 생성: ${decisionPacket.recommendation.substring(0, 50)}...`);
  console.log(`   신뢰도: ${(decisionPacket.overallConfidence * 100).toFixed(1)}%\n`);
  
  // 4. Human Governance: Proposal 생성 및 투표
  console.log('4. Human Governance: Proposal 생성 중...');
  const proposal = await governanceService.createProposalFromDecisionPacket(decisionPacket, {
    votingDurationDays: 7,
    minParticipationRate: 0.1,
    passingThreshold: 0.5,
  });
  
  // Agora에 전송
  await agoraIntegration.convertToAgoraProposal(decisionPacket);
  
  console.log(`   Proposal 생성: ${proposal.title}\n`);
  
  // 투표 시뮬레이션
  console.log('5. 투표 진행 중...');
  await governanceService.activateProposal(proposal.id);
  
  // 예시 투표
  await governanceService.castVote(proposal.id, '0x1234...', 'yes', 1000);
  await governanceService.castVote(proposal.id, '0x5678...', 'yes', 500);
  await governanceService.castVote(proposal.id, '0x9abc...', 'no', 200);
  
  const result = await governanceService.calculateProposalResult(proposal.id);
  console.log(`   투표 결과: ${result.passed ? '통과' : '부결'}\n`);
  
  if (result.passed) {
    // 6. Atomic Actuation: 실행
    console.log('6. Atomic Actuation: 실행 중...');
    const execution = await atomicActuation.executeProposal(proposal);
    console.log(`   실행 상태: ${execution.status}\n`);
    
    // 7. Proof of Outcome: 결과 측정
    console.log('7. Proof of Outcome: 결과 측정 중...');
    const outcome = await proofOfOutcome.createOutcome(
      proposal,
      decisionPacket,
      execution.startedAt
    );
    
    // KPI 측정 (예시)
    // await proofOfOutcome.measureKPIs(...);
    
    const finalizedOutcome = await proofOfOutcome.finalizeOutcome(
      outcome.id,
      execution.completedAt || Date.now()
    );
    
    console.log(`   결과 평가: ${finalizedOutcome.evaluation?.success ? '성공' : '실패'}`);
    console.log(`   성공률: ${(finalizedOutcome.evaluation?.successRate || 0) * 100}%\n`);
  }
  
  console.log('=== Governance Loop 완료 ===');
}

/**
 * 간단한 예제 실행
 */
if (require.main === module) {
  runGovernanceLoop().catch(console.error);
}









