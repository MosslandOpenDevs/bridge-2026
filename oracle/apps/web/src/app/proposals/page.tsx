"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Vote, Clock, CheckCircle, XCircle, Bot, ChevronDown, ChevronUp, Loader2, AlertCircle, Zap, FlaskConical, Info, ExternalLink } from "lucide-react";
import { cn, getStatusColor, timeAgo, formatNumber } from "@/lib/utils";
import { useSignMessage } from "wagmi";
import { useVotingPower, useAccount } from "@/hooks/useMOC";
import { useToast } from "@/contexts/ToastContext";
import { api, type ProposalListItem } from "@/lib/api";
import { useHasAdminKey } from "@/hooks/useAdminKey";
import { VOTING_ENABLED } from "@/lib/voting";

// Where Mossland DAO actually decides. Nothing voted on this page binds it.
const AGORA_URL = "https://agora.moss.land";

type DisplayStatus = ProposalListItem["status"];

/**
 * The status a reader should see, which is not always the one stored.
 *
 * A proposal that closes without reaching quorum was nobody's "no": no one
 * turned up. Labelling it "Rejected" told readers the community had voted
 * these proposals down, when in production not one vote was ever cast on any
 * of them. The API is moving those to "expired"; until that migration has run,
 * the legacy rows are still stored as "rejected", so a rejection whose tally
 * never reached quorum is shown as the expiry it was.
 */
function displayStatus(proposal: ProposalListItem): DisplayStatus {
  if (proposal.status === "rejected" && proposal.tally && !proposal.tally.quorumReached) {
    return "expired";
  }
  return proposal.status;
}

/**
 * The `status` to ask the API for, given the status filter picked on the page.
 * "expired" has none: it covers stored "expired" rows and legacy no-quorum
 * "rejected" ones, which one status param cannot select together, so that
 * filter fetches every status and displayStatus() sorts it out.
 */
function serverStatusFilter(filter: string): string | undefined {
  return filter === "active" || filter === "passed" || filter === "rejected" ? filter : undefined;
}

type SyntheticProposalStats = { total: number; active: number; passed: number; rejected: number };

/**
 * How many demo proposals the toggle is keeping out of the current status
 * filter: 0 for none, null for "some, but the count cannot be known".
 *
 * Counting every demo proposal whatever the filter said "143 hidden" under
 * "Active", when almost none of them were. The counts come from /api/stats,
 * which splits by stored status. That settles active and passed, but not
 * rejected against expired: a legacy no-quorum row is stored "rejected" and
 * shown "expired". For those two filters, only whether any demo proposal
 * closed without passing is known.
 */
function hiddenSyntheticCount(filter: string, synthetic: SyntheticProposalStats): number | null {
  if (filter === "all") return synthetic.total;
  if (filter === "active") return synthetic.active;
  if (filter === "passed") return synthetic.passed;
  return synthetic.total - synthetic.active - synthetic.passed > 0 ? null : 0;
}

/** Whether an active proposal can still take votes; the API refuses them after votingEndsAt. */
function isOpenForVoting(proposal: ProposalListItem, now: number): boolean {
  return proposal.status === "active" && new Date(proposal.votingEndsAt).getTime() > now;
}

/**
 * Time left to vote. Rounding up to whole days read "0d" both for a proposal
 * with hours left and for one whose voting had already ended but that nothing
 * had closed out yet, so the two are told apart and short spans get hours.
 */
function remainingLabel(votingEndsAt: Date, now: number, t: any): string {
  const ms = votingEndsAt.getTime() - now;
  if (ms <= 0) return t("proposals.votingClosed");
  const hours = Math.floor(ms / 3_600_000);
  const days = Math.floor(hours / 24);
  const span =
    days >= 1
      ? `${days}d ${hours % 24}h`
      : hours >= 1
        ? `${hours}h`
        : `${Math.max(1, Math.ceil(ms / 60_000))}m`;
  return t("proposals.timeLeft", { time: span });
}

/**
 * Active first, since those are the only ones anyone can act on, then newest
 * first. The API returns insertion order, which put the single active
 * production proposal last of 164.
 */
function compareProposals(a: ProposalListItem, b: ProposalListItem): number {
  const activeRank = (p: ProposalListItem) => (p.status === "active" ? 0 : 1);
  return (
    activeRank(a) - activeRank(b) ||
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

// Must match buildVoteMessage() in apps/api/src/security.ts exactly.
function buildVoteMessage(params: {
  proposalId: string;
  choice: string;
  voter: string;
  nonce: string;
  timestamp: number;
}): string {
  const { proposalId, choice, voter, nonce, timestamp } = params;
  return [
    "BRIDGE Oracle Vote",
    `Proposal: ${proposalId}`,
    `Voter: ${voter.toLowerCase()}`,
    `Choice: ${choice.toLowerCase()}`,
    `Nonce: ${nonce}`,
    `Timestamp: ${timestamp}`,
  ].join("\n");
}

function VotingBar({ forVotes, againstVotes, abstainVotes, t }: { forVotes: number; againstVotes: number; abstainVotes: number; t: any }) {
  const total = forVotes + againstVotes + abstainVotes;
  if (total === 0) return null;

  const forPercent = (forVotes / total) * 100;
  const againstPercent = (againstVotes / total) * 100;

  return (
    <div className="w-full">
      <div className="flex h-2 rounded-full overflow-hidden bg-gray-200">
        <div className="bg-green-500" style={{ width: `${forPercent}%` }} />
        <div className="bg-red-500" style={{ width: `${againstPercent}%` }} />
      </div>
      <div className="flex justify-between mt-1 text-xs text-gray-500">
        <span>{t("proposals.for")} {forPercent.toFixed(1)}%</span>
        <span>{t("proposals.against")} {againstPercent.toFixed(1)}%</span>
      </div>
    </div>
  );
}

function VoteModal({ proposal, onClose, onSuccess, t }: { proposal: any; onClose: () => void; onSuccess: () => void; t: any }) {
  const { formatted, votingPower } = useVotingPower();
  const { address } = useAccount();
  const toast = useToast();
  const tToast = useTranslations("toast");
  const [selectedChoice, setSelectedChoice] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Extract title from decisionPacket
  const dp = proposal.decisionPacket;
  const rec = dp?.recommendation;
  const proposalTitle = proposal.title ||
    (typeof rec?.action === "string" ? rec.action : rec?.action?.action) ||
    dp?.issue?.title ||
    `Proposal #${proposal.id.slice(0, 8)}`;

  const { signMessageAsync } = useSignMessage();

  const voteMutation = useMutation({
    mutationFn: async () => {
      if (!selectedChoice || !address) throw new Error("Invalid vote");
      // Sign the vote so the API can verify it (EIP-191, anti-spoofing).
      const nonce = crypto.randomUUID();
      const timestamp = Date.now();
      const signature = await signMessageAsync({
        message: buildVoteMessage({
          proposalId: proposal.id,
          choice: selectedChoice,
          voter: address,
          nonce,
          timestamp,
        }),
      });
      return api.castVote(
        proposal.id,
        address,
        selectedChoice,
        votingPower?.toString() || "1",
        reason || undefined,
        { signature, nonce, timestamp }
      );
    },
    onSuccess: () => {
      toast.success(tToast("voteSuccess.title"), tToast("voteSuccess.message"), {
        category: "vote",
      });
      onSuccess();
      onClose();
    },
    onError: (err: Error) => {
      toast.error(tToast("voteError.title"), err.message, {
        category: "vote",
      });
      setError(err.message);
    },
  });

  const handleVote = () => {
    if (!selectedChoice) return;
    setError(null);
    voteMutation.mutate();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">{t("proposals.vote")}</h3>
        <p className="text-sm text-gray-600 mb-4">{proposalTitle}</p>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start space-x-2">
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <div className="mb-4">
          <p className="text-sm text-gray-500 mb-2">{t("proposals.voteWeight")}: <span className="font-semibold text-moss-600">{formatted} MOC</span></p>
        </div>

        <div className="space-y-2 mb-4">
          {[
            { value: "for", label: t("proposals.for"), icon: CheckCircle, color: "text-green-600 border-green-500 bg-green-50" },
            { value: "against", label: t("proposals.against"), icon: XCircle, color: "text-red-600 border-red-500 bg-red-50" },
            { value: "abstain", label: t("proposals.abstain"), icon: Vote, color: "text-gray-600 border-gray-500 bg-gray-50" },
          ].map((choice) => (
            <button
              key={choice.value}
              onClick={() => setSelectedChoice(choice.value)}
              disabled={voteMutation.isPending}
              className={cn(
                "w-full flex items-center space-x-3 p-3 rounded-lg border-2 transition-all",
                selectedChoice === choice.value ? choice.color : "border-gray-200 hover:border-gray-300",
                voteMutation.isPending && "opacity-50 cursor-not-allowed"
              )}
            >
              <choice.icon className="w-5 h-5" />
              <span className="font-medium">{choice.label}</span>
            </button>
          ))}
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">{t("proposals.reason")}</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={voteMutation.isPending}
            className="w-full border border-gray-300 rounded-lg p-2 text-sm disabled:opacity-50"
            rows={3}
          />
        </div>

        <div className="flex space-x-3">
          <button
            onClick={onClose}
            disabled={voteMutation.isPending}
            className="btn-secondary flex-1 disabled:opacity-50"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={handleVote}
            disabled={!selectedChoice || voteMutation.isPending}
            className="btn-primary flex-1 disabled:opacity-50 flex items-center justify-center"
          >
            {voteMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {t("proposals.voting")}
              </>
            ) : (
              t("proposals.castVote")
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ProposalsPage() {
  const t = useTranslations();
  const tToast = useTranslations("toast");
  const toast = useToast();
  const { isConnected } = useAccount();
  const hasAdminKey = useHasAdminKey();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<string>("all");
  const [showSynthetic, setShowSynthetic] = useState(false);
  const [votingProposal, setVotingProposal] = useState<any>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // The server does the filtering. Unfiltered, this poll pulled every row
  // (3.36MB uncompressed in production, mostly demo data the page then hid)
  // every 30s, and the API tallied each one. Only the legacy remap stays
  // client-side, below.
  const { data, isLoading } = useQuery({
    queryKey: ["proposals", { filter, showSynthetic }],
    queryFn: () =>
      api.getProposals({
        status: serverStatusFilter(filter),
        synthetic: showSynthetic ? "include" : "exclude",
      }),
    refetchInterval: 30000,
  });

  // With demo rows excluded server-side, how many were left out comes from
  // /api/stats, which splits its proposal totals on the same query the list
  // filters on. Same key as the dashboard, so it shares that cache.
  const { data: stats } = useQuery({
    queryKey: ["stats"],
    queryFn: () => api.getStats(),
    refetchInterval: 60000,
    enabled: !showSynthetic,
  });

  // The clock that decides "Xm left" and whether Vote is offered has to tick
  // on its own. Read during render, it only moved when something re-rendered,
  // and a refetch returning identical data does not; with no votes ever cast
  // in production the data never changes, so a page left open past
  // votingEndsAt kept offering a vote the API would refuse.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const allProposals = data?.proposals ?? [];
  const hiddenSynthetic =
    showSynthetic || !stats ? 0 : hiddenSyntheticCount(filter, stats.proposals.synthetic);
  const hiddenSyntheticLabel =
    hiddenSynthetic === null
      ? t("proposals.syntheticHiddenUncounted")
      : t("proposals.syntheticHidden", { count: hiddenSynthetic });
  const proposals = allProposals
    .filter((p) => showSynthetic || !p.synthetic)
    .filter((p) => filter === "all" || displayStatus(p) === filter)
    .sort(compareProposals);

  const handleVoteSuccess = () => {
    // Invalidate and refetch proposals
    queryClient.invalidateQueries({ queryKey: ["proposals"] });
  };

  // Execute mutation
  const executeMutation = useMutation({
    mutationFn: (proposalId: string) => api.executeProposal(proposalId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["proposals"] });
      toast.success(tToast("executionSuccess.title"), tToast("executionSuccess.message"), {
        category: "proposal",
      });
    },
    onError: (err: Error) => {
      toast.error(tToast("executionError.title"), err.message, {
        category: "proposal",
      });
    },
  });


  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">{t("proposals.title")}</h1>
          <p className="mt-1 text-sm sm:text-base text-gray-500">{t("proposals.subtitle")}</p>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <button
            type="button"
            onClick={() => setShowSynthetic(!showSynthetic)}
            aria-pressed={showSynthetic}
            className={cn(
              "inline-flex items-center justify-center gap-1 rounded-lg border px-3 py-2 text-sm",
              showSynthetic
                ? "border-amber-300 bg-amber-50 text-amber-800"
                : "border-gray-300 bg-white text-gray-600 hover:border-gray-400"
            )}
          >
            <FlaskConical className="w-4 h-4" aria-hidden="true" />
            {t("proposals.showSynthetic")}
          </button>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="border-gray-300 rounded-lg text-sm w-full sm:w-auto"
          >
            <option value="all">{t("common.all")}</option>
            <option value="active">{t("proposals.active")}</option>
            <option value="passed">{t("proposals.passed")}</option>
            <option value="rejected">{t("proposals.rejected")}</option>
            <option value="expired">{t("proposals.expired")}</option>
          </select>
        </div>
      </div>

      {/* Non-binding framing. BRIDGE is a lab: its agents write these
          proposals and nothing voted here reaches the DAO. Mossland DAO
          decides on Agora, and a reader who landed here should learn that
          before reading any of the rows below as governance. */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        <div className="flex items-start gap-2">
          <Info className="w-5 h-5 flex-shrink-0 text-blue-600 mt-0.5" aria-hidden="true" />
          <div className="space-y-1">
            <p className="font-semibold">{t("proposals.labNoticeTitle")}</p>
            <p>{t("proposals.labNoticeBody")}</p>
            <p>
              {t("proposals.agoraNotice")}{" "}
              <a
                href={AGORA_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-medium text-blue-700 underline hover:text-blue-800"
              >
                {t("proposals.agoraLink")}
                <ExternalLink className="w-3 h-3" aria-hidden="true" />
              </a>
            </p>
          </div>
        </div>
      </div>

      {hiddenSynthetic !== 0 && proposals.length > 0 && (
        <p className="flex items-center gap-1 text-xs text-gray-500">
          <FlaskConical className="w-3 h-3" aria-hidden="true" />
          {hiddenSyntheticLabel}
        </p>
      )}

      {/* Proposals List */}
      <div className="space-y-4">
        {isLoading ? (
          <div className="card flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-moss-600" />
          </div>
        ) : proposals.length === 0 && hiddenSynthetic !== 0 ? (
          // Nothing real matches, but demo rows do. "No proposals yet" would
          // say there is nothing here at all.
          <div className="card text-center py-12 text-gray-500">
            <FlaskConical className="w-12 h-12 mx-auto mb-3 text-gray-300" aria-hidden="true" />
            <p>{t("proposals.noRealProposals")}</p>
            <p className="text-sm">{hiddenSyntheticLabel}</p>
            <button
              type="button"
              onClick={() => setShowSynthetic(true)}
              className="mt-3 inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-600 hover:border-gray-400"
            >
              <FlaskConical className="w-4 h-4" aria-hidden="true" />
              {t("proposals.showSynthetic")}
            </button>
          </div>
        ) : proposals.length === 0 ? (
          <div className="card text-center py-12 text-gray-500">
            <Vote className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p>{t("proposals.noProposals")}</p>
            <p className="text-sm">{t("proposals.createFirst")}</p>
          </div>
        ) : (
          proposals.map((proposal) => {
            // The tally comes from the API. Reading forVotes/againstVotes off
            // the proposal itself always yielded 0: those fields never existed
            // on the object, so every proposal showed no votes however many
            // had been cast.
            const tally = proposal.tally;
            const forVotes = Number(tally?.forVotes ?? 0);
            const againstVotes = Number(tally?.againstVotes ?? 0);
            const abstainVotes = Number(tally?.abstainVotes ?? 0);
            const total = forVotes + againstVotes + abstainVotes;
            // Quorum counts ballots, not weight, so measure the indicator
            // against the number of votes cast.
            const quorum = Number(proposal.quorum || 1);
            const voteCount = Number(tally?.voteCount ?? 0);
            const quorumPercent = Math.min(100, (voteCount / quorum) * 100);
            const isExpanded = expandedId === proposal.id;
            const votingEndsAt = new Date(proposal.votingEndsAt);
            const status = displayStatus(proposal);
            const openForVoting = isOpenForVoting(proposal, now);

            // Extract title and description from decisionPacket or direct fields
            const dp = proposal.decisionPacket;
            const rec = dp?.recommendation;
            const proposalTitle = proposal.title ||
              (typeof rec?.action === "string" ? rec.action : rec?.action?.action) ||
              dp?.issue?.title ||
              `Proposal #${proposal.id.slice(0, 8)}`;
            const proposalDescription = proposal.description ||
              proposal.summary ||
              (typeof rec?.rationale === "string" ? rec.rationale : "") ||
              dp?.issue?.description ||
              "";
            const expectedOutcome = typeof rec?.expectedOutcome === "string" ? rec.expectedOutcome : "";

            return (
              <div key={proposal.id} className="card p-4 sm:p-6">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center flex-wrap gap-1 sm:gap-2 mb-2">
                      <span
                        className={cn("badge text-xs", getStatusColor(status))}
                        title={status === "expired" ? t("proposals.expiredHint") : undefined}
                      >
                        {/* Every status is named explicitly. The old fallthrough
                            rendered anything unrecognised as "Rejected". */}
                        {status === "active" ? t("proposals.active") :
                         status === "passed" ? t("proposals.passed") :
                         status === "executed" ? t("proposals.executed") :
                         status === "pending" ? t("proposals.pending") :
                         status === "expired" ? t("proposals.expired") :
                         status === "rejected" ? t("proposals.rejected") : status}
                      </span>
                      {(proposal.aiAssisted || dp) && (
                        <span className="badge bg-purple-50 text-purple-600 text-xs">
                          <Bot className="w-3 h-3 mr-1 inline" />
                          AI
                        </span>
                      )}
                      {proposal.synthetic && (
                        <span
                          className="badge bg-amber-100 text-amber-800 flex items-center gap-1 text-xs"
                          title={t("proposals.syntheticHint")}
                        >
                          <FlaskConical className="w-3 h-3" aria-hidden="true" />
                          {t("common.synthetic")}
                        </span>
                      )}
                    </div>
                    <h3 className="text-base sm:text-lg font-semibold text-gray-900 line-clamp-2">{proposalTitle}</h3>
                    <p className="mt-1 text-xs sm:text-sm text-gray-500 line-clamp-2">{proposalDescription}</p>
                    {expectedOutcome && (
                      <p className="mt-2 text-xs sm:text-sm text-moss-600 line-clamp-2">
                        <span className="font-medium">{t("issues.expectedOutcome")}:</span> {expectedOutcome}
                      </p>
                    )}

                    <div className="mt-4">
                      <VotingBar
                        forVotes={forVotes}
                        againstVotes={againstVotes}
                        abstainVotes={abstainVotes}
                        t={t}
                      />
                    </div>

                    <div className="mt-3 flex items-center flex-wrap gap-2 sm:gap-4 text-xs sm:text-sm text-gray-500">
                      <span className="flex items-center">
                        <Clock className="w-3 h-3 sm:w-4 sm:h-4 mr-1" />
                        {proposal.status === "active"
                          ? remainingLabel(votingEndsAt, now, t)
                          : timeAgo(votingEndsAt)}
                      </span>
                      <span>{formatNumber(total)} MOC</span>
                      <span>{t("proposals.quorum")} {quorumPercent.toFixed(0)}%</span>
                    </div>
                  </div>

                  <div className="flex flex-row sm:flex-col items-center sm:items-end gap-2 sm:ml-4">
                    {/* Voting here is off unless NEXT_PUBLIC_VOTING_ENABLED is
                        set; the notice above sends readers to Agora. */}
                    {VOTING_ENABLED && openForVoting && isConnected && (
                      <button
                        onClick={() => setVotingProposal(proposal)}
                        className="btn-primary text-sm py-2 px-4 flex-1 sm:flex-none"
                      >
                        {t("proposals.vote")}
                      </button>
                    )}
                    {/* Execution is an operator action, not a wallet action:
                        it is gated on the admin key, not on a connected wallet. */}
                    {proposal.status === "passed" && hasAdminKey && (
                      <button
                        onClick={() => executeMutation.mutate(proposal.id)}
                        disabled={executeMutation.isPending}
                        className="btn-primary bg-purple-600 hover:bg-purple-700 flex items-center disabled:opacity-50 text-sm py-2 px-4 flex-1 sm:flex-none"
                      >
                        {executeMutation.isPending ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <Zap className="w-4 h-4 mr-2" />
                        )}
                        {t("proposals.execute")}
                      </button>
                    )}
                    {proposal.status === "executed" && (
                      <span className="text-xs sm:text-sm text-purple-600 flex items-center">
                        <CheckCircle className="w-4 h-4 mr-1" />
                        {t("proposals.executed")}
                      </span>
                    )}
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : proposal.id)}
                      className="text-xs sm:text-sm text-gray-500 flex items-center p-2"
                    >
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      <span className="hidden sm:inline ml-1">{t("common.view")}</span>
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="mt-4 pt-4 border-t border-gray-100 space-y-4">
                    {/* Vote Statistics */}
                    <div className="grid grid-cols-3 gap-2 sm:gap-4 text-center">
                      <div className="p-2 sm:p-3 bg-green-50 rounded-lg">
                        <p className="text-lg sm:text-2xl font-bold text-green-600">{formatNumber(forVotes)}</p>
                        <p className="text-xs sm:text-sm text-green-700">{t("proposals.for")}</p>
                      </div>
                      <div className="p-2 sm:p-3 bg-red-50 rounded-lg">
                        <p className="text-lg sm:text-2xl font-bold text-red-600">{formatNumber(againstVotes)}</p>
                        <p className="text-xs sm:text-sm text-red-700">{t("proposals.against")}</p>
                      </div>
                      <div className="p-2 sm:p-3 bg-gray-50 rounded-lg">
                        <p className="text-lg sm:text-2xl font-bold text-gray-600">{formatNumber(abstainVotes)}</p>
                        <p className="text-xs sm:text-sm text-gray-700">{t("proposals.abstain")}</p>
                      </div>
                    </div>

                    {/* Purpose (Issue Context) */}
                    {dp?.issue && (
                      <div>
                        <h4 className="text-sm font-medium text-gray-700 mb-2">{t("proposals.purpose")}</h4>
                        <div className="text-sm p-3 bg-blue-50 rounded-lg">
                          <p className="text-blue-700">{dp.issue.description}</p>
                          {dp.issue.evidence && dp.issue.evidence.length > 0 && (
                            <div className="mt-2 text-xs text-blue-600">
                              {t("proposals.evidenceCount")}: {dp.issue.evidence.length}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Consensus Score & Proposal Type */}
                    {(dp?.consensusScore !== undefined || dp?.recommendedProposalType) && (
                      <div>
                        <h4 className="text-sm font-medium text-gray-700 mb-2">{t("proposals.consensus")}</h4>
                        <div className="flex items-center space-x-4 p-3 bg-purple-50 rounded-lg">
                          {dp.consensusScore !== undefined && (
                            <div className="flex items-center space-x-2">
                              <span className="text-sm text-purple-700">{t("proposals.score")}:</span>
                              <span className={cn(
                                "font-bold",
                                dp.consensusScore >= 0.7 ? "text-green-600" :
                                dp.consensusScore >= 0.5 ? "text-yellow-600" : "text-red-600"
                              )}>
                                {Math.round(dp.consensusScore * 100)}%
                              </span>
                            </div>
                          )}
                          {dp.recommendedProposalType && (
                            <span className={cn(
                              "badge",
                              dp.recommendedProposalType === "action" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"
                            )}>
                              {dp.recommendedProposalType === "action" ? t("proposals.typeAction") : t("proposals.typeInvestigation")}
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Agent Opinions Summary */}
                    {dp?.agentOpinions && dp.agentOpinions.length > 0 && (
                      <div>
                        <h4 className="text-sm font-medium text-gray-700 mb-2">{t("proposals.agentOpinions")}</h4>
                        <div className="space-y-2">
                          {dp.agentOpinions.map((opinion: any, i: number) => (
                            <div key={i} className="p-3 bg-gray-50 rounded-lg">
                              <div className="flex items-center justify-between mb-1">
                                <span className="font-medium text-gray-700 capitalize">{opinion.role || opinion.agentRole}</span>
                                <div className="flex items-center space-x-2">
                                  <span className={cn(
                                    "text-xs px-2 py-0.5 rounded",
                                    (opinion.stance || "").includes("support") ? "bg-green-100 text-green-700" :
                                    (opinion.stance || "").includes("oppose") ? "bg-red-100 text-red-700" : "bg-gray-200 text-gray-600"
                                  )}>
                                    {opinion.stance}
                                  </span>
                                  <span className="text-xs text-gray-500">
                                    {Math.round((opinion.confidence || 0) * 100)}%
                                  </span>
                                </div>
                              </div>
                              <p className="text-sm text-gray-600">{opinion.reasoning}</p>
                              {opinion.recommendations && opinion.recommendations.length > 0 && (
                                <div className="mt-2 text-xs text-moss-600">
                                  {opinion.recommendations.slice(0, 2).join(", ")}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Goals & KPIs */}
                    {dp?.kpis && dp.kpis.length > 0 && (
                      <div>
                        <h4 className="text-xs sm:text-sm font-medium text-gray-700 mb-2">{t("proposals.goals")}</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {dp.kpis.map((kpi: any, i: number) => (
                            <div key={i} className="p-2 bg-moss-50 rounded-lg text-xs sm:text-sm">
                              <p className="font-medium text-moss-700">{kpi.name}</p>
                              <p className="text-moss-600">{t("proposals.target")}: {kpi.target} {kpi.unit}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Alternatives */}
                    {dp?.alternatives && dp.alternatives.length > 0 && (
                      <div>
                        <h4 className="text-sm font-medium text-gray-700 mb-2">{t("proposals.alternatives")}</h4>
                        <div className="space-y-2">
                          {dp.alternatives.map((alt: any, i: number) => (
                            <div key={i} className="text-sm p-2 bg-gray-50 rounded-lg">
                              <p className="font-medium text-gray-700">{alt.action}</p>
                              {alt.pros && alt.pros.length > 0 && (
                                <p className="text-green-600 text-xs mt-1">+ {alt.pros.join(", ")}</p>
                              )}
                              {alt.cons && alt.cons.length > 0 && (
                                <p className="text-red-600 text-xs">- {alt.cons.join(", ")}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Risks */}
                    {dp?.risks && dp.risks.length > 0 && (
                      <div>
                        <h4 className="text-sm font-medium text-gray-700 mb-2">{t("issues.risks")}</h4>
                        <div className="space-y-2">
                          {dp.risks.map((risk: any, i: number) => (
                            <div key={i} className="text-sm p-2 bg-red-50 rounded-lg">
                              {typeof risk === "string" ? (
                                <p>{risk}</p>
                              ) : (
                                <>
                                  <p className="font-medium text-red-700">{risk.description}</p>
                                  <div className="mt-1 flex flex-wrap gap-2 text-xs">
                                    <span className="px-2 py-0.5 bg-red-100 rounded">
                                      {t("issues.likelihood")}: {risk.likelihood}
                                    </span>
                                    <span className="px-2 py-0.5 bg-red-100 rounded">
                                      {t("issues.impact")}: {risk.impact}
                                    </span>
                                  </div>
                                  {risk.mitigation && (
                                    <p className="mt-1 text-gray-600">
                                      <span className="font-medium">{t("issues.mitigation")}:</span> {risk.mitigation}
                                    </p>
                                  )}
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Proposal Info */}
                    <div className="text-sm text-gray-500 pt-2 border-t border-gray-100">
                      <p>{t("proposals.proposer")}: <span className="font-mono text-gray-700">{proposal.proposer}</span></p>
                      <p>{t("proposals.quorum")}: {formatNumber(voteCount)} / {formatNumber(quorum)} {t("proposals.votesUnit")} ({quorumPercent.toFixed(1)}% {t("proposals.reached") || "reached"})</p>
                      <p>ID: <span className="font-mono text-xs">{proposal.id}</span></p>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {VOTING_ENABLED && votingProposal && (
        <VoteModal
          proposal={votingProposal}
          onClose={() => setVotingProposal(null)}
          onSuccess={handleVoteSuccess}
          t={t}
        />
      )}
    </div>
  );
}
