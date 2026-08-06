import { expect } from "chai";
import hre from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

const { ethers } = hre;

enum VoteChoice {
  For = 0,
  Against = 1,
  Abstain = 2,
}

enum ProposalStatus {
  Pending = 0,
  Active = 1,
  Passed = 2,
  Rejected = 3,
  Executed = 4,
  Cancelled = 5,
}

const PACKET_HASH = ethers.keccak256(ethers.toUtf8Bytes("decision-packet"));

async function deploy() {
  const [admin, relayer, alice, bob, carol] = await ethers.getSigners();
  const factory = await ethers.getContractFactory("OracleGovernance");
  const governance = await factory.deploy();
  await governance.waitForDeployment();

  const ORACLE_ROLE = await governance.ORACLE_ROLE();
  await governance.grantRole(ORACLE_ROLE, relayer.address);

  return { governance, admin, relayer, alice, bob, carol, ORACLE_ROLE };
}

async function createProposal(
  governance: any,
  { quorum = 0, threshold = 0, votingPeriod = 0 } = {},
) {
  const tx = await governance.createProposal(
    PACKET_HASH,
    "ipfs://metadata",
    quorum,
    threshold,
    votingPeriod,
  );
  await tx.wait();
  return await governance.proposalCount();
}

describe("OracleGovernance", () => {
  describe("relayed voting", () => {
    it("records each voter separately even though one account relays them all", async () => {
      // The original castVote keyed duplicate detection on msg.sender. Since
      // every relayed vote is sent by the same oracle account, the first vote
      // blocked all the others with "Already voted", which made relaying
      // unusable. Guard against that regression.
      const { governance, relayer, alice, bob, carol } = await deploy();
      const proposalId = await createProposal(governance);

      const relayed = governance.connect(relayer);
      await relayed.castVoteFor(proposalId, alice.address, VoteChoice.For, 100);
      await relayed.castVoteFor(proposalId, bob.address, VoteChoice.For, 50);
      await relayed.castVoteFor(proposalId, carol.address, VoteChoice.Against, 30);

      const proposal = await governance.getProposal(proposalId);
      expect(proposal.forVotes).to.equal(150n);
      expect(proposal.againstVotes).to.equal(30n);

      expect(await governance.hasVoted(proposalId, alice.address)).to.equal(true);
      expect(await governance.hasVoted(proposalId, bob.address)).to.equal(true);
      // The relayer itself never votes.
      expect(await governance.hasVoted(proposalId, relayer.address)).to.equal(false);
    });

    it("rejects a second vote from the same holder", async () => {
      const { governance, relayer, alice } = await deploy();
      const proposalId = await createProposal(governance);
      const relayed = governance.connect(relayer);

      await relayed.castVoteFor(proposalId, alice.address, VoteChoice.For, 100);
      await expect(
        relayed.castVoteFor(proposalId, alice.address, VoteChoice.Against, 100),
      ).to.be.revertedWith("Already voted");
    });

    it("only lets ORACLE_ROLE submit votes", async () => {
      const { governance, alice, bob } = await deploy();
      const proposalId = await createProposal(governance);

      await expect(
        governance.connect(alice).castVoteFor(proposalId, bob.address, VoteChoice.For, 1),
      ).to.be.reverted;
    });

    it("rejects zero weight and the zero address", async () => {
      const { governance, relayer, alice } = await deploy();
      const proposalId = await createProposal(governance);
      const relayed = governance.connect(relayer);

      await expect(
        relayed.castVoteFor(proposalId, alice.address, VoteChoice.For, 0),
      ).to.be.revertedWith("Weight must be positive");
      await expect(
        relayed.castVoteFor(proposalId, ethers.ZeroAddress, VoteChoice.For, 1),
      ).to.be.revertedWith("Voter required");
    });

    it("rejects votes after the voting period", async () => {
      const { governance, relayer, alice } = await deploy();
      const proposalId = await createProposal(governance, { votingPeriod: 3600 });

      await time.increase(3601);
      await expect(
        governance.connect(relayer).castVoteFor(proposalId, alice.address, VoteChoice.For, 1),
      ).to.be.revertedWith("Voting period ended");
    });

    it("applies a batch atomically", async () => {
      const { governance, relayer, alice, bob, carol } = await deploy();
      const proposalId = await createProposal(governance);
      const relayed = governance.connect(relayer);

      await relayed.castVotesFor(
        proposalId,
        [alice.address, bob.address],
        [VoteChoice.For, VoteChoice.Against],
        [10, 4],
      );
      let proposal = await governance.getProposal(proposalId);
      expect(proposal.forVotes).to.equal(10n);
      expect(proposal.againstVotes).to.equal(4n);

      // Carol is new, Alice has already voted: the whole batch must revert so
      // Carol's vote is not applied on its own.
      await expect(
        relayed.castVotesFor(
          proposalId,
          [carol.address, alice.address],
          [VoteChoice.For, VoteChoice.For],
          [1, 1],
        ),
      ).to.be.revertedWith("Already voted");

      proposal = await governance.getProposal(proposalId);
      expect(proposal.forVotes).to.equal(10n);
      expect(await governance.hasVoted(proposalId, carol.address)).to.equal(false);
    });

    it("rejects a batch with mismatched array lengths", async () => {
      const { governance, relayer, alice, bob } = await deploy();
      const proposalId = await createProposal(governance);

      await expect(
        governance
          .connect(relayer)
          .castVotesFor(
            proposalId,
            [alice.address, bob.address],
            [VoteChoice.For],
            [1, 1],
          ),
      ).to.be.revertedWith("Length mismatch");
    });
  });

  describe("finalization", () => {
    it("refuses to finalize while voting is open", async () => {
      const { governance } = await deploy();
      const proposalId = await createProposal(governance, { votingPeriod: 3600 });

      await expect(governance.finalizeProposal(proposalId)).to.be.revertedWith(
        "Voting still ongoing",
      );
    });

    it("passes a proposal that clears quorum and threshold", async () => {
      const { governance, relayer, alice, bob } = await deploy();
      const proposalId = await createProposal(governance, {
        quorum: 100,
        threshold: 50,
        votingPeriod: 3600,
      });
      const relayed = governance.connect(relayer);
      await relayed.castVoteFor(proposalId, alice.address, VoteChoice.For, 80);
      await relayed.castVoteFor(proposalId, bob.address, VoteChoice.Against, 20);

      await time.increase(3601);
      await governance.finalizeProposal(proposalId);

      const proposal = await governance.getProposal(proposalId);
      expect(proposal.status).to.equal(ProposalStatus.Passed);
      expect(await governance.executionEta(proposalId)).to.be.greaterThan(0n);
    });

    it("rejects a proposal that misses quorum", async () => {
      const { governance, relayer, alice } = await deploy();
      const proposalId = await createProposal(governance, {
        quorum: 1000,
        threshold: 50,
        votingPeriod: 3600,
      });
      await governance
        .connect(relayer)
        .castVoteFor(proposalId, alice.address, VoteChoice.For, 10);

      await time.increase(3601);
      await governance.finalizeProposal(proposalId);

      const proposal = await governance.getProposal(proposalId);
      expect(proposal.status).to.equal(ProposalStatus.Rejected);
      expect(await governance.executionEta(proposalId)).to.equal(0n);
    });
  });

  describe("execution timelock", () => {
    it("refuses to execute before the timelock elapses", async () => {
      const { governance, relayer, alice } = await deploy();
      const proposalId = await createProposal(governance, {
        quorum: 1,
        threshold: 50,
        votingPeriod: 3600,
      });
      await governance
        .connect(relayer)
        .castVoteFor(proposalId, alice.address, VoteChoice.For, 10);
      await time.increase(3601);
      await governance.finalizeProposal(proposalId);

      await expect(governance.executeProposal(proposalId)).to.be.revertedWith(
        "Timelock not elapsed",
      );
    });

    it("executes once the timelock has elapsed", async () => {
      const { governance, relayer, alice } = await deploy();
      const proposalId = await createProposal(governance, {
        quorum: 1,
        threshold: 50,
        votingPeriod: 3600,
      });
      await governance
        .connect(relayer)
        .castVoteFor(proposalId, alice.address, VoteChoice.For, 10);
      await time.increase(3601);
      await governance.finalizeProposal(proposalId);

      await time.increase(2 * 24 * 60 * 60 + 1);
      await expect(governance.executeProposal(proposalId)).to.emit(
        governance,
        "ProposalExecuted",
      );

      const proposal = await governance.getProposal(proposalId);
      expect(proposal.status).to.equal(ProposalStatus.Executed);
    });

    it("only lets EXECUTOR_ROLE execute", async () => {
      const { governance, relayer, alice } = await deploy();
      const proposalId = await createProposal(governance, {
        quorum: 1,
        threshold: 50,
        votingPeriod: 3600,
      });
      await governance
        .connect(relayer)
        .castVoteFor(proposalId, alice.address, VoteChoice.For, 10);
      await time.increase(3601);
      await governance.finalizeProposal(proposalId);
      await time.increase(2 * 24 * 60 * 60 + 1);

      await expect(governance.connect(alice).executeProposal(proposalId)).to.be
        .reverted;
    });
  });

  describe("outcome proofs", () => {
    it("refuses an outcome for a proposal that has not executed", async () => {
      const { governance } = await deploy();
      const proposalId = await createProposal(governance);

      await expect(
        governance.recordOutcome(proposalId, PACKET_HASH, 100, true),
      ).to.be.revertedWith("Proposal not executed");
    });
  });

  describe("pausing", () => {
    it("blocks voting while paused", async () => {
      const { governance, relayer, alice } = await deploy();
      const proposalId = await createProposal(governance);
      await governance.pause();

      await expect(
        governance.connect(relayer).castVoteFor(proposalId, alice.address, VoteChoice.For, 1),
      ).to.be.reverted;
    });

    it("only lets PAUSER_ROLE pause", async () => {
      const { governance, alice } = await deploy();
      await expect(governance.connect(alice).pause()).to.be.reverted;
    });
  });
});
