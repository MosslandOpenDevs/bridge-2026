import { RawSignal, NormalizedSignal, SignalSource } from "@oracle/core";
import { BaseAdapter } from "./base.js";

export interface GitHubAdapterConfig {
  token?: string;
  organization?: string;
  repositories?: string[];
  language?: "en" | "ko";
}

const translations = {
  en: {
    orgStats: "Mossland GitHub: {public} public, {private} private repos, {stars} stars",
    repoUpdate: "{repo} repository updated",
    privateRepoUpdate: "[Private Repository] updated ({size} KB)",
    commit: "[{repo}] {message} (by {author})",
    privateCommit: "[Private Repository] {count} commits ({date})",
    release: "New release: {repo} {tag} - {name}",
    privateRelease: "[Private Repository] new release",
    activity: "GitHub Activity: {contributors} contributors, {push} push, {pr} PR{privateNote}",
    privateNote: " (private: {count})",
    privateContent: "Private repository - details hidden",
    privateLabel: "[Private Repository]",
    unit: {
      repos: "repos",
      kb: "KB",
      commits: "commits",
      release: "release",
      events: "events",
    },
  },
  ko: {
    orgStats: "Mossland GitHub: {public} public, {private} private repos, {stars} stars",
    repoUpdate: "{repo} 저장소 업데이트",
    privateRepoUpdate: "[Private Repository] 저장소 업데이트 ({size} KB)",
    commit: "[{repo}] {message} (by {author})",
    privateCommit: "[Private Repository] 커밋 {count}건 ({date})",
    release: "새 릴리즈: {repo} {tag} - {name}",
    privateRelease: "[Private Repository] 새 릴리즈 출시",
    activity: "GitHub 활동: {contributors}명 기여자, {push} push, {pr} PR{privateNote}",
    privateNote: " (private: {count}건)",
    privateContent: "비공개 저장소 - 상세 내용 비공개",
    privateLabel: "[Private Repository]",
    unit: {
      repos: "repos",
      kb: "KB",
      commits: "commits",
      release: "release",
      events: "events",
    },
  },
};

const GITHUB_API = "https://api.github.com";
const DEFAULT_ORG = "mossland";

interface Repository {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  pushed_at: string;
  updated_at: string;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  language: string | null;
  private: boolean;
  size: number;
}

interface Commit {
  sha: string;
  commit: {
    message: string;
    author: {
      name: string;
      date: string;
    };
  };
  html_url: string;
  author: {
    login: string;
    avatar_url: string;
  } | null;
  stats?: {
    additions: number;
    deletions: number;
    total: number;
  };
}

interface Release {
  id: number;
  tag_name: string;
  name: string;
  body: string;
  html_url: string;
  published_at: string;
  author: {
    login: string;
  };
}

interface Event {
  id: string;
  type: string;
  actor: {
    login: string;
    avatar_url: string;
  };
  repo: {
    name: string;
  };
  created_at: string;
  payload: Record<string, unknown>;
}

// Private repo masking constants are now in translations

export class GitHubAdapter extends BaseAdapter {
  readonly name = "GitHubAdapter";
  readonly source: SignalSource = "api";

  private config: GitHubAdapterConfig;
  private headers: Record<string, string>;
  private lastEventId: string = "";
  private repoPrivacyCache: Map<string, boolean> = new Map();

  constructor(config: GitHubAdapterConfig = {}) {
    super();
    this.config = {
      organization: config.organization || DEFAULT_ORG,
      repositories: config.repositories || [],
      token: config.token,
      language: config.language || "en",
    };
    this.headers = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "ORACLE-Signal-Collector",
    };
    if (config.token) {
      this.headers["Authorization"] = `Bearer ${config.token}`;
    }
  }

  private get t() {
    return translations[this.config.language || "en"];
  }

  async fetch(): Promise<RawSignal[]> {
    const signals: RawSignal[] = [];

    try {
      // 1. Fetch organization repositories (and cache privacy status)
      const repoSignals = await this.fetchRepositories();
      signals.push(...repoSignals);

      // 2. Fetch recent commits from active repos
      const commitSignals = await this.fetchRecentCommits();
      signals.push(...commitSignals);

      // 3. Fetch releases
      const releaseSignals = await this.fetchReleases();
      signals.push(...releaseSignals);

      // 4. Fetch organization events
      const eventSignals = await this.fetchEvents();
      signals.push(...eventSignals);

    } catch (error) {
      console.error("[GitHubAdapter] Error fetching data:", error);
    }

    return signals;
  }

  private isPrivateRepo(repoName: string): boolean {
    return this.repoPrivacyCache.get(repoName) ?? false;
  }

  private maskRepoName(repoName: string, isPrivate: boolean): string {
    return isPrivate ? this.t.privateLabel : repoName;
  }

  private async fetchRepositories(): Promise<RawSignal[]> {
    const signals: RawSignal[] = [];
    const url = `${GITHUB_API}/orgs/${this.config.organization}/repos?sort=pushed&per_page=10`;

    try {
      const response = await fetch(url, { headers: this.headers });
      const repos = await response.json() as Repository[];

      if (Array.isArray(repos)) {
        // Cache privacy status for each repo
        for (const repo of repos) {
          this.repoPrivacyCache.set(repo.name, repo.private);
        }

        // Aggregate stats (safe for both public and private)
        const totalStars = repos.reduce((sum, r) => sum + r.stargazers_count, 0);
        const totalForks = repos.reduce((sum, r) => sum + r.forks_count, 0);
        const totalIssues = repos.reduce((sum, r) => sum + r.open_issues_count, 0);
        const publicRepoCount = repos.filter(r => !r.private).length;
        const privateRepoCount = repos.filter(r => r.private).length;

        signals.push(this.createRawSignal(
          `github-org-stats-${Date.now()}`,
          {
            type: "org_stats",
            organization: this.config.organization,
            repoCount: repos.length,
            publicRepoCount,
            privateRepoCount,
            totalStars,
            totalForks,
            totalOpenIssues: totalIssues,
            // Only show details for public repos
            activeRepos: repos.slice(0, 5).map(r => ({
              name: this.maskRepoName(r.name, r.private),
              isPrivate: r.private,
              pushedAt: r.pushed_at,
              stars: r.private ? undefined : r.stargazers_count,
              language: r.private ? undefined : r.language,
              size: r.size, // KB - statistical, safe to show
            })),
          },
          {
            apiEndpoint: url,
          }
        ));

        // Check for recently updated repos (within last hour)
        const oneHourAgo = Date.now() - 3600000;
        for (const repo of repos) {
          const pushedAt = new Date(repo.pushed_at).getTime();
          if (pushedAt > oneHourAgo) {
            signals.push(this.createRawSignal(
              `github-repo-update-${repo.private ? "private" : repo.name}-${Date.now()}`,
              {
                type: "repo_update",
                isPrivate: repo.private,
                // Public: show all details
                // Private: only show statistical info
                repoName: this.maskRepoName(repo.name, repo.private),
                fullName: repo.private ? this.t.privateLabel : repo.full_name,
                description: repo.private ? this.t.privateContent : repo.description,
                url: repo.private ? undefined : repo.html_url,
                pushedAt: repo.pushed_at,
                stars: repo.private ? undefined : repo.stargazers_count,
                language: repo.private ? undefined : repo.language,
                size: repo.size,
              },
              {
                apiEndpoint: repo.private ? undefined : repo.html_url,
              }
            ));
          }
        }
      }
    } catch (error) {
      console.error("[GitHubAdapter] Repository fetch error:", error);
    }

    return signals;
  }

  private async fetchRecentCommits(): Promise<RawSignal[]> {
    const signals: RawSignal[] = [];

    // Fetch commits from main repos
    const mainRepos = this.config.repositories?.length
      ? this.config.repositories
      : ["mossverse", "mossland-marketplace"];

    for (const repoName of mainRepos) {
      const url = `${GITHUB_API}/repos/${this.config.organization}/${repoName}/commits?per_page=5`;

      try {
        const response = await fetch(url, { headers: this.headers });
        if (!response.ok) continue;

        const commits = await response.json() as Commit[];
        const isPrivate = this.isPrivateRepo(repoName);

        if (Array.isArray(commits) && commits.length > 0) {
          const recentCommit = commits[0];

          // For private repos: only statistical info
          // For public repos: full details
          signals.push(this.createRawSignal(
            `github-commit-${recentCommit.sha.slice(0, 7)}-${Date.now()}`,
            {
              type: "commit",
              isPrivate,
              repoName: this.maskRepoName(repoName, isPrivate),
              sha: isPrivate ? recentCommit.sha.slice(0, 7) : recentCommit.sha,
              // Private: hide commit message and author name
              message: isPrivate ? this.t.privateContent : recentCommit.commit.message.split("\n")[0],
              author: isPrivate ? undefined : recentCommit.commit.author.name,
              authorLogin: isPrivate ? undefined : recentCommit.author?.login,
              date: recentCommit.commit.author.date,
              url: isPrivate ? undefined : recentCommit.html_url,
              commitCount: commits.length,
              // Statistical info (safe to show)
              stats: recentCommit.stats ? {
                additions: recentCommit.stats.additions,
                deletions: recentCommit.stats.deletions,
                total: recentCommit.stats.total,
              } : undefined,
            },
            {
              apiEndpoint: isPrivate ? undefined : url,
            }
          ));
        }
      } catch (error) {
        console.error(`[GitHubAdapter] Commit fetch error for ${repoName}:`, error);
      }
    }

    return signals;
  }

  private async fetchReleases(): Promise<RawSignal[]> {
    const signals: RawSignal[] = [];
    const url = `${GITHUB_API}/orgs/${this.config.organization}/repos?per_page=10`;

    try {
      const reposResponse = await fetch(url, { headers: this.headers });
      const repos = await reposResponse.json() as Repository[];

      if (!Array.isArray(repos)) return signals;

      for (const repo of repos.slice(0, 5)) {
        const releaseUrl = `${GITHUB_API}/repos/${this.config.organization}/${repo.name}/releases?per_page=1`;
        const releaseResponse = await fetch(releaseUrl, { headers: this.headers });

        if (!releaseResponse.ok) continue;

        const releases = await releaseResponse.json() as Release[];
        const isPrivate = repo.private;

        if (Array.isArray(releases) && releases.length > 0) {
          const release = releases[0];
          const publishedAt = new Date(release.published_at).getTime();
          const oneWeekAgo = Date.now() - 7 * 24 * 3600000;

          // Only signal recent releases (within a week)
          if (publishedAt > oneWeekAgo) {
            signals.push(this.createRawSignal(
              `github-release-${release.id}-${Date.now()}`,
              {
                type: "release",
                isPrivate,
                repoName: this.maskRepoName(repo.name, isPrivate),
                // Private: hide release details
                tagName: isPrivate ? undefined : release.tag_name,
                name: isPrivate ? this.t.privateContent : release.name,
                body: isPrivate ? undefined : release.body?.slice(0, 200),
                url: isPrivate ? undefined : release.html_url,
                publishedAt: release.published_at,
                author: isPrivate ? undefined : release.author.login,
              },
              {
                apiEndpoint: isPrivate ? undefined : releaseUrl,
              }
            ));
          }
        }
      }
    } catch (error) {
      console.error("[GitHubAdapter] Release fetch error:", error);
    }

    return signals;
  }

  private async fetchEvents(): Promise<RawSignal[]> {
    const signals: RawSignal[] = [];
    const url = `${GITHUB_API}/orgs/${this.config.organization}/events?per_page=30`;

    try {
      const response = await fetch(url, { headers: this.headers });
      const events = await response.json() as Event[];

      if (Array.isArray(events) && events.length > 0) {
        // Count event types (statistical only)
        const eventCounts: Record<string, number> = {};
        const contributors = new Set<string>();
        let publicEventCount = 0;
        let privateEventCount = 0;

        for (const event of events) {
          eventCounts[event.type] = (eventCounts[event.type] || 0) + 1;
          contributors.add(event.actor.login);

          // Check if event is from private repo
          const repoName = event.repo.name.split("/")[1];
          if (this.isPrivateRepo(repoName)) {
            privateEventCount++;
          } else {
            publicEventCount++;
          }
        }

        // Only include public repo activity in recent activity list
        const publicEvents = events.filter(e => {
          const repoName = e.repo.name.split("/")[1];
          return !this.isPrivateRepo(repoName);
        });

        signals.push(this.createRawSignal(
          `github-activity-${Date.now()}`,
          {
            type: "activity_summary",
            totalEvents: events.length,
            publicEventCount,
            privateEventCount,
            uniqueContributors: contributors.size,
            eventBreakdown: eventCounts,
            // Only show details for public repo events
            recentActivity: publicEvents.slice(0, 5).map(e => ({
              type: e.type,
              actor: e.actor.login,
              repo: e.repo.name,
              createdAt: e.created_at,
            })),
            // Summary for private repos (no details)
            privateRepoSummary: privateEventCount > 0 ? {
              eventCount: privateEventCount,
              notice: this.t.privateContent,
            } : undefined,
          },
          {
            apiEndpoint: url,
          }
        ));
      }
    } catch (error) {
      console.error("[GitHubAdapter] Events fetch error:", error);
    }

    return signals;
  }

  normalize(signal: RawSignal): NormalizedSignal {
    const data = signal.data as {
      type: string;
      isPrivate?: boolean;
      repoCount?: number;
      publicRepoCount?: number;
      privateRepoCount?: number;
      totalStars?: number;
      totalOpenIssues?: number;
      repoName?: string;
      message?: string;
      author?: string;
      tagName?: string;
      name?: string;
      totalEvents?: number;
      publicEventCount?: number;
      privateEventCount?: number;
      uniqueContributors?: number;
      eventBreakdown?: Record<string, number>;
      url?: string;
      commitCount?: number;
      date?: string;
      size?: number;
    };

    const t = this.t;
    let category: string;
    let severity: NormalizedSignal["severity"];
    let value: number;
    let unit: string;
    let description: string;

    switch (data.type) {
      case "org_stats":
        category = "github_overview";
        severity = "low";
        value = data.repoCount || 0;
        unit = t.unit.repos;
        description = t.orgStats
          .replace("{public}", String(data.publicRepoCount || 0))
          .replace("{private}", String(data.privateRepoCount || 0))
          .replace("{stars}", String(data.totalStars || 0));
        break;

      case "repo_update":
        category = "github_push";
        severity = "medium";
        value = data.size || 0;
        unit = t.unit.kb;
        if (data.isPrivate) {
          description = t.privateRepoUpdate.replace("{size}", (data.size?.toLocaleString() || "0"));
        } else {
          description = t.repoUpdate.replace("{repo}", data.repoName || "");
        }
        break;

      case "commit":
        category = "github_commit";
        severity = "low";
        value = data.commitCount || 1;
        unit = t.unit.commits;
        if (data.isPrivate) {
          const dateStr = data.date ? new Date(data.date).toLocaleString(this.config.language === "ko" ? "ko-KR" : "en-US") : "";
          description = t.privateCommit
            .replace("{count}", String(data.commitCount || 1))
            .replace("{date}", dateStr);
        } else {
          description = t.commit
            .replace("{repo}", data.repoName || "")
            .replace("{message}", data.message || "")
            .replace("{author}", data.author || "");
        }
        break;

      case "release":
        category = "github_release";
        severity = "high";
        value = 1;
        unit = t.unit.release;
        if (data.isPrivate) {
          description = t.privateRelease;
        } else {
          description = t.release
            .replace("{repo}", data.repoName || "")
            .replace("{tag}", data.tagName || "")
            .replace("{name}", data.name || "");
        }
        break;

      case "activity_summary": {
        category = "github_activity";
        severity = (data.totalEvents || 0) > 20 ? "medium" : "low";
        value = data.totalEvents || 0;
        unit = t.unit.events;
        const pushCount = data.eventBreakdown?.["PushEvent"] || 0;
        const prCount = data.eventBreakdown?.["PullRequestEvent"] || 0;
        const privateNote = data.privateEventCount
          ? t.privateNote.replace("{count}", String(data.privateEventCount))
          : "";
        description = t.activity
          .replace("{contributors}", String(data.uniqueContributors || 0))
          .replace("{push}", String(pushCount))
          .replace("{pr}", String(prCount))
          .replace("{privateNote}", privateNote);
        break;
      }

      default:
        category = "github_unknown";
        severity = "low";
        value = 0;
        unit = "";
        description = "Unknown GitHub signal";
    }

    return this.createNormalizedSignal(signal, category, severity, value, unit, description);
  }
}
