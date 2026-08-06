/**
 * GitHub Collector
 * 
 * 오픈소스 개발 신호를 수집하는 수집기입니다.
 * PR, 이슈, 릴리즈, 빌드 실패율 등을 신호로 변환합니다.
 */

import { BaseCollector } from '../base-collector';
import type { Signal, SignalSource } from '@bridge-2026/shared';

/**
 * GitHub 수집기 설정
 */
export interface GitHubCollectorConfig {
  /** 리포지토리 정보 */
  repositories: Array<{
    owner: string;
    repo: string;
    name?: string; // 표시용 이름
  }>;
  /** GitHub Personal Access Token */
  token?: string;
  /** 수집 간격 (밀리초) */
  interval?: number;
  /** 수집할 이벤트 타입 */
  eventTypes?: ('pr' | 'issue' | 'release' | 'workflow')[];
}

/**
 * GitHub 수집기
 */
export class GitHubCollector extends BaseCollector {
  private config: GitHubCollectorConfig;
  private lastCollectionTime: Map<string, number> = new Map();
  
  constructor(config: GitHubCollectorConfig) {
    super('GitHub Collector', 'telemetry' as SignalSource);
    this.config = config;
  }
  
  /**
   * 신호를 수집합니다.
   */
  async collect(): Promise<Signal[]> {
    const signals: Signal[] = [];
    const now = Date.now();
    const interval = this.config.interval || 300000; // 기본 5분
    
    try {
      for (const repo of this.config.repositories) {
        const repoKey = `${repo.owner}/${repo.repo}`;
        const lastTime = this.lastCollectionTime.get(repoKey) || 0;
        
        if (now - lastTime < interval) {
          continue; // 아직 수집 시간이 아님
        }
        
        const repoSignals = await this.collectFromRepository(repo);
        signals.push(...repoSignals);
        
        this.lastCollectionTime.set(repoKey, now);
      }
    } catch (error) {
      console.error('Error collecting GitHub data:', error);
    }
    
    return signals;
  }
  
  /**
   * 특정 리포지토리에서 데이터를 수집합니다.
   */
  private async collectFromRepository(repo: {
    owner: string;
    repo: string;
    name?: string;
  }): Promise<Signal[]> {
    const signals: Signal[] = [];
    const eventTypes = this.config.eventTypes || ['pr', 'issue', 'release', 'workflow'];
    
    for (const eventType of eventTypes) {
      try {
        switch (eventType) {
          case 'pr':
            signals.push(...await this.collectPullRequests(repo));
            break;
          case 'issue':
            signals.push(...await this.collectIssues(repo));
            break;
          case 'release':
            signals.push(...await this.collectReleases(repo));
            break;
          case 'workflow':
            signals.push(...await this.collectWorkflows(repo));
            break;
        }
      } catch (error) {
        console.error(`Error collecting ${eventType} for ${repo.owner}/${repo.repo}:`, error);
      }
    }
    
    return signals;
  }
  
  /**
   * Pull Request 데이터를 수집합니다.
   */
  private async collectPullRequests(repo: {
    owner: string;
    repo: string;
  }): Promise<Signal[]> {
    // TODO: 실제 GitHub API 호출
    // 예시:
    // const response = await fetch(
    //   `https://api.github.com/repos/${repo.owner}/${repo.repo}/pulls?state=open`,
    //   {
    //     headers: {
    //       'Authorization': `token ${this.config.token}`,
    //       'Accept': 'application/vnd.github.v3+json',
    //     },
    //   }
    // );
    // const prs = await response.json();
    
    // 임시 데이터
    const signal = this.createSignal(
      {
        source: 'github',
        type: 'pull_request',
        repository: `${repo.owner}/${repo.repo}`,
        openPRs: Math.floor(Math.random() * 10),
        mergedPRs: Math.floor(Math.random() * 5),
        closedPRs: Math.floor(Math.random() * 3),
        averageReviewTime: 2 + Math.random() * 5, // 일
      },
      {
        type: 'development' as any,
        confidence: 0.9,
        tags: ['github', 'pull-request', repo.owner, repo.repo],
      }
    );
    
    return [signal];
  }
  
  /**
   * Issue 데이터를 수집합니다.
   */
  private async collectIssues(repo: {
    owner: string;
    repo: string;
  }): Promise<Signal[]> {
    // TODO: 실제 GitHub API 호출
    
    const signal = this.createSignal(
      {
        source: 'github',
        type: 'issue',
        repository: `${repo.owner}/${repo.repo}`,
        openIssues: Math.floor(Math.random() * 20),
        closedIssues: Math.floor(Math.random() * 10),
        averageResolutionTime: 5 + Math.random() * 10, // 일
        bugCount: Math.floor(Math.random() * 5),
        featureRequestCount: Math.floor(Math.random() * 3),
      },
      {
        type: 'development' as any,
        confidence: 0.9,
        tags: ['github', 'issue', repo.owner, repo.repo],
      }
    );
    
    return [signal];
  }
  
  /**
   * Release 데이터를 수집합니다.
   */
  private async collectReleases(repo: {
    owner: string;
    repo: string;
  }): Promise<Signal[]> {
    // TODO: 실제 GitHub API 호출
    
    const signal = this.createSignal(
      {
        source: 'github',
        type: 'release',
        repository: `${repo.owner}/${repo.repo}`,
        latestRelease: 'v1.0.0',
        releaseDate: new Date().toISOString(),
        daysSinceLastRelease: Math.floor(Math.random() * 30),
      },
      {
        type: 'development' as any,
        confidence: 0.9,
        tags: ['github', 'release', repo.owner, repo.repo],
      }
    );
    
    return [signal];
  }
  
  /**
   * Workflow (CI/CD) 데이터를 수집합니다.
   */
  private async collectWorkflows(repo: {
    owner: string;
    repo: string;
  }): Promise<Signal[]> {
    // TODO: 실제 GitHub API 호출
    
    const signal = this.createSignal(
      {
        source: 'github',
        type: 'workflow',
        repository: `${repo.owner}/${repo.repo}`,
        totalRuns: Math.floor(Math.random() * 100),
        successRate: 0.7 + Math.random() * 0.3,
        failureRate: 0.1 + Math.random() * 0.2,
        averageBuildTime: 5 + Math.random() * 10, // 분
      },
      {
        type: 'development' as any,
        confidence: 0.9,
        tags: ['github', 'workflow', 'ci-cd', repo.owner, repo.repo],
      }
    );
    
    return [signal];
  }
  
  /**
   * 개발 메트릭을 분석합니다.
   */
  analyzeDevelopmentMetrics(signals: Signal[]): {
    healthScore: number; // 0-1
    issues: string[];
    recommendations: string[];
  } {
    const prSignals = signals.filter(s => s.data.type === 'pull_request');
    const issueSignals = signals.filter(s => s.data.type === 'issue');
    const workflowSignals = signals.filter(s => s.data.type === 'workflow');
    
    let healthScore = 1.0;
    const issues: string[] = [];
    const recommendations: string[] = [];
    
    // PR 분석
    for (const signal of prSignals) {
      const openPRs = signal.data.openPRs as number || 0;
      if (openPRs > 20) {
        healthScore -= 0.1;
        issues.push('열린 PR이 너무 많습니다');
        recommendations.push('PR 리뷰 프로세스 개선 필요');
      }
      
      const avgReviewTime = signal.data.averageReviewTime as number || 0;
      if (avgReviewTime > 7) {
        healthScore -= 0.1;
        issues.push('PR 리뷰 시간이 너무 깁니다');
        recommendations.push('리뷰 프로세스 자동화 고려');
      }
    }
    
    // Issue 분석
    for (const signal of issueSignals) {
      const openIssues = signal.data.openIssues as number || 0;
      if (openIssues > 50) {
        healthScore -= 0.1;
        issues.push('열린 이슈가 너무 많습니다');
        recommendations.push('이슈 우선순위화 및 정리 필요');
      }
      
      const bugCount = signal.data.bugCount as number || 0;
      if (bugCount > 10) {
        healthScore -= 0.15;
        issues.push('버그가 많이 누적되었습니다');
        recommendations.push('버그 수정 스프린트 계획');
      }
    }
    
    // Workflow 분석
    for (const signal of workflowSignals) {
      const successRate = signal.data.successRate as number || 0;
      if (successRate < 0.8) {
        healthScore -= 0.2;
        issues.push('CI/CD 성공률이 낮습니다');
        recommendations.push('빌드 실패 원인 분석 및 수정');
      }
      
      const failureRate = signal.data.failureRate as number || 0;
      if (failureRate > 0.2) {
        healthScore -= 0.15;
        issues.push('빌드 실패율이 높습니다');
        recommendations.push('테스트 안정성 개선');
      }
    }
    
    healthScore = Math.max(0, Math.min(1, healthScore));
    
    return {
      healthScore,
      issues,
      recommendations,
    };
  }
}









