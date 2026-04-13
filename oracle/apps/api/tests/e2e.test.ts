/**
 * ORACLE API E2E Test Suite
 *
 * Run with: npx tsx tests/e2e.test.ts
 * Make sure the API server is running on localhost:4000
 */

const API_BASE = process.env.API_BASE || "http://localhost:4000";

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}

const results: TestResult[] = [];

async function runTest(name: string, testFn: () => Promise<void>) {
  const start = Date.now();
  try {
    await testFn();
    results.push({ name, passed: true, duration: Date.now() - start });
    console.log(`✅ ${name}`);
  } catch (error: any) {
    results.push({ name, passed: false, error: error.message, duration: Date.now() - start });
    console.log(`❌ ${name}: ${error.message}`);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

async function fetchJson(path: string, options?: RequestInit) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  const data = await response.json();
  return { response, data };
}

// ==================== TESTS ====================

async function testHealthCheck() {
  const { response, data } = await fetchJson("/health");
  assert(response.ok, "Health check should return 200");
  assert(data.status === "ok", "Status should be 'ok'");
  assert(typeof data.version === "string", "Version should be a string");
  assert(typeof data.timestamp === "string", "Timestamp should be a string");
}

async function testGetSignals() {
  const { response, data } = await fetchJson("/api/signals");
  assert(response.ok, "Get signals should return 200");
  assert(Array.isArray(data.signals), "Signals should be an array");
  assert(typeof data.count === "number", "Count should be a number");
}

async function testCollectSignals() {
  const { response, data } = await fetchJson("/api/signals/collect", {
    method: "POST",
  });
  assert(response.ok, "Collect signals should return 200");
  assert(typeof data.collected === "number", "Collected should be a number");
  assert(Array.isArray(data.signals), "Signals should be an array");
}

async function testGetIssues() {
  const { response, data } = await fetchJson("/api/issues");
  assert(response.ok, "Get issues should return 200");
  assert(Array.isArray(data.issues), "Issues should be an array");
  assert(typeof data.count === "number", "Count should be a number");
}

async function testDetectIssues() {
  const { response, data } = await fetchJson("/api/issues/detect", {
    method: "POST",
  });
  assert(response.ok, "Detect issues should return 200");
  assert(typeof data.detected === "number", "Detected should be a number");
  assert(typeof data.saved === "number", "Saved should be a number");
}

async function testDeliberate() {
  const issue = {
    id: "test-issue-e2e",
    title: "E2E Test Issue",
    description: "This is a test issue for E2E testing",
    category: "governance",
    priority: "high",
  };

  const { response, data } = await fetchJson("/api/deliberate", {
    method: "POST",
    body: JSON.stringify({ issue }),
  });

  assert(response.ok, "Deliberate should return 200");
  assert(data.decisionPacket, "Should return a decision packet");
  assert(data.decisionPacket.recommendation, "Should have recommendation");
  assert(typeof data.decisionPacket.recommendation === "object", "Recommendation should be an object");
  assert(data.decisionPacket.recommendation.action, "Recommendation should have action");
  assert(data.decisionPacket.recommendation.rationale, "Recommendation should have rationale");
  assert(Array.isArray(data.decisionPacket.risks), "Should have risks array");
}

async function testGetProposals() {
  const { response, data } = await fetchJson("/api/proposals");
  assert(response.ok, "Get proposals should return 200");
  assert(Array.isArray(data.proposals), "Proposals should be an array");
  assert(typeof data.count === "number", "Count should be a number");
}

async function testCreateProposal() {
  const decisionPacket = {
    id: `e2e-test-${Date.now()}`,
    issueId: "test-issue",
    recommendation: {
      action: "E2E Test Action",
      rationale: "E2E Test Rationale",
      expectedOutcome: "E2E Test Outcome",
    },
    risks: [],
  };

  const { response, data } = await fetchJson("/api/proposals", {
    method: "POST",
    body: JSON.stringify({
      decisionPacket,
      proposer: "0xE2E_TEST",
    }),
  });

  assert(response.ok, "Create proposal should return 201");
  assert(data.proposal, "Should return a proposal");
  assert(data.proposal.id, "Proposal should have an ID");
  assert(data.proposal.status === "active", "Proposal should be active");

  return data.proposal.id;
}

async function testCastVote(proposalId: string) {
  // Address validation requires a real 20-byte hex address; pad a deterministic test address.
  const suffix = Date.now().toString(16).padStart(16, "0").slice(-16);
  const voter = ("0x" + "e2eA".repeat(6) + suffix).toLowerCase();
  const { response, data } = await fetchJson(`/api/proposals/${proposalId}/vote`, {
    method: "POST",
    body: JSON.stringify({
      voter,
      choice: "for",
      weight: "1000",
      reason: "E2E test vote",
    }),
  });

  assert(response.ok, "Cast vote should return 201");
  assert(data.vote, "Should return a vote");
  assert(data.vote.choice === "for", "Vote choice should be 'for'");
  assert(data.vote.weight === "1000", "Vote weight should be '1000'");
}

async function testTallyVotes(proposalId: string) {
  const { response, data } = await fetchJson(`/api/proposals/${proposalId}/tally`, {
    method: "POST",
  });

  assert(response.ok, "Tally votes should return 200");
  assert(data.tally, "Should return a tally");
  assert(typeof data.tally.forVotes === "string", "forVotes should be a string (BigInt)");
  assert(typeof data.tally.participationRate === "number", "participationRate should be a number");
}

async function testFinalizeProposal(proposalId: string) {
  const { response, data } = await fetchJson(`/api/proposals/${proposalId}/finalize`, {
    method: "POST",
  });

  assert(response.ok, "Finalize should return 200");
  assert(data.proposal, "Should return a proposal");
  assert(["passed", "rejected"].includes(data.proposal.status), "Proposal should be passed or rejected");
  return data.proposal.status;
}

async function testExecuteProposal(proposalId: string) {
  const { response, data } = await fetchJson(`/api/proposals/${proposalId}/execute`, {
    method: "POST",
  });

  assert(response.ok, `Execute should return 200, got ${response.status}`);
  assert(data.proposal, "Should return a proposal");
  assert(data.proposal.status === "executed", "Proposal should be executed");
  assert(data.execution, "Should return an execution record");
  assert(data.message === "Proposal executed successfully", "Should return success message");
}

async function testGetStats() {
  const { response, data } = await fetchJson("/api/stats");
  assert(response.ok, "Get stats should return 200");
  assert(data.signals, "Should have signals stats");
  assert(data.proposals, "Should have proposals stats");
  assert(data.outcomes, "Should have outcomes stats");
}

async function testUpdateIssue() {
  // First get an issue
  const { data: issuesData } = await fetchJson("/api/issues");
  if (issuesData.issues.length === 0) {
    console.log("⏭️  Skipping testUpdateIssue - no issues available");
    return;
  }

  const issueId = issuesData.issues[0].id;
  const { response, data } = await fetchJson(`/api/issues/${issueId}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "deliberating" }),
  });

  assert(response.ok, "Update issue should return 200");
  assert(data.issue, "Should return updated issue");
  assert(data.issue.status === "deliberating", "Issue status should be updated");
}

async function testGetTrustScore() {
  const { response, data } = await fetchJson("/api/trust/test-entity");
  // Trust score returns 404 for non-existent entities, 200 for existing ones
  if (response.status === 404) {
    assert(data.error === "Entity not found", "Should return 'Entity not found' for non-existent entity");
  } else {
    assert(response.ok, "Get trust score should return 200 for existing entity");
    assert(data.score, "Should return a score object");
    assert(typeof data.score.overall === "number", "Should have overall score");
  }
}

// ==================== FLOW TESTS ====================

async function testFullWorkflow() {
  console.log("\n--- Full Workflow Test ---");

  // 1. Collect signals
  const { data: signalsData } = await fetchJson("/api/signals/collect", { method: "POST" });
  assert(signalsData.collected >= 0, "Should collect some signals");
  console.log(`   Collected ${signalsData.collected} signals`);

  // 2. Detect issues
  const { data: issuesData } = await fetchJson("/api/issues/detect", { method: "POST" });
  console.log(`   Detected ${issuesData.detected} issues, saved ${issuesData.saved} new`);

  // 3. Get an issue and deliberate
  const { data: allIssues } = await fetchJson("/api/issues");
  if (allIssues.issues.length > 0) {
    const issue = allIssues.issues[0];
    const { data: deliberation } = await fetchJson("/api/deliberate", {
      method: "POST",
      body: JSON.stringify({ issue }),
    });
    assert(deliberation.decisionPacket, "Deliberation should return decision packet");
    console.log(`   Deliberated on issue: ${issue.title.substring(0, 50)}...`);

    // 4. Create proposal from decision
    const { data: proposalData } = await fetchJson("/api/proposals", {
      method: "POST",
      body: JSON.stringify({
        decisionPacket: deliberation.decisionPacket,
        proposer: "0xE2E_WORKFLOW",
      }),
    });
    assert(proposalData.proposal.status === "active", "Proposal should be active");
    console.log(`   Created proposal: ${proposalData.proposal.id}`);

    // 5. Cast votes — addresses must be valid 20-byte hex per security validation.
    for (let i = 0; i < 3; i++) {
      const voter = "0x" + "deadbeef".repeat(5) + i.toString().padStart(2, "0");
      await fetchJson(`/api/proposals/${proposalData.proposal.id}/vote`, {
        method: "POST",
        body: JSON.stringify({
          voter,
          choice: i < 2 ? "for" : "against",
          weight: "100",
        }),
      });
    }
    console.log("   Cast 3 votes (2 for, 1 against)");

    // 6. Tally votes
    const { data: tallyData } = await fetchJson(`/api/proposals/${proposalData.proposal.id}/tally`, {
      method: "POST",
    });
    console.log(`   Tally: ${tallyData.tally.forVotes} for, ${tallyData.tally.againstVotes} against`);
  }

  console.log("--- Full Workflow Complete ---\n");
}

// ==================== DELEGATION TESTS ====================

async function testGetDelegations() {
  const { response, data } = await fetchJson("/api/delegations");
  assert(response.ok, "Get delegations should return 200");
  assert(Array.isArray(data.policies), "Policies should be an array");
  assert(typeof data.count === "number", "Count should be a number");
}

async function testCreateDelegation() {
  const { response, data } = await fetchJson("/api/delegations", {
    method: "POST",
    body: JSON.stringify({
      delegator: `0xDELEGATOR_${Date.now()}`,
      delegate: "risk-agent",
      conditions: [
        { field: "decisionPacket.issue.category", operator: "in", value: ["governance", "security"] },
        { field: "decisionPacket.budget", operator: "lte", value: 10000 },
      ],
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    }),
  });

  assert(response.ok, "Create delegation should return 201");
  assert(data.policy, "Should return a policy");
  assert(data.policy.id, "Policy should have an ID");
  assert(data.policy.active === true, "Policy should be active");

  return data.policy.id;
}

async function testGetDelegation(policyId: string) {
  const { response, data } = await fetchJson(`/api/delegations/${policyId}`);
  assert(response.ok, "Get delegation should return 200");
  assert(data.policy, "Should return a policy");
  assert(data.policy.id === policyId, "Policy ID should match");
}

async function testRevokeDelegation(policyId: string) {
  const { response, data } = await fetchJson(`/api/delegations/${policyId}`, {
    method: "DELETE",
  });

  assert(response.ok, "Revoke delegation should return 200");
  assert(data.message === "Delegation revoked", "Should return revoke message");
  assert(data.policy.active === false, "Policy should be inactive");
}

async function testCheckDelegation() {
  // First create a delegation
  const { data: createData } = await fetchJson("/api/delegations", {
    method: "POST",
    body: JSON.stringify({
      delegator: `0xCHECK_DELEGATOR_${Date.now()}`,
      delegate: "community-agent",
      conditions: [{ field: "decisionPacket.issue.category", operator: "in", value: ["governance"] }],
    }),
  });

  // Create a proposal to check against
  const { data: proposalData } = await fetchJson("/api/proposals", {
    method: "POST",
    body: JSON.stringify({
      decisionPacket: {
        id: `e2e-check-${Date.now()}`,
        issueId: "test-issue",
        recommendation: { action: "Test", rationale: "Testing", expectedOutcome: "Success" },
        risks: [],
      },
      proposer: "0xE2E_CHECK_TEST",
    }),
  });

  // Check delegation
  const { response, data } = await fetchJson(
    `/api/delegations/check/${proposalData.proposal.id}?delegator=${createData.policy.delegator}`
  );

  assert(response.ok, "Check delegation should return 200");
  assert(typeof data.shouldDelegate === "boolean", "Should return shouldDelegate boolean");
}

// ==================== RUN TESTS ====================

async function main() {
  console.log("\n🧪 ORACLE API E2E Tests\n");
  console.log(`Testing against: ${API_BASE}\n`);
  console.log("=".repeat(50) + "\n");

  // Health & Basic Tests
  await runTest("Health Check", testHealthCheck);
  await runTest("Get Signals", testGetSignals);
  await runTest("Collect Signals", testCollectSignals);
  await runTest("Get Issues", testGetIssues);
  await runTest("Detect Issues", testDetectIssues);
  await runTest("Deliberate", testDeliberate);
  await runTest("Get Proposals", testGetProposals);
  await runTest("Get Stats", testGetStats);
  await runTest("Get Trust Score", testGetTrustScore);
  await runTest("Update Issue", testUpdateIssue);

  // Proposal & Voting Tests
  let proposalId: string | undefined;
  await runTest("Create Proposal", async () => {
    proposalId = await testCreateProposal();
  });

  if (proposalId) {
    await runTest("Cast Vote", async () => {
      await testCastVote(proposalId!);
    });
    await runTest("Tally Votes", async () => {
      await testTallyVotes(proposalId!);
    });
    await runTest("Finalize Proposal", async () => {
      await testFinalizeProposal(proposalId!);
    });
  }

  // Execute test - need to create a new proposal that passes (separate from above)
  await runTest("Execute Proposal", async () => {
    // Create a fresh proposal for execution test
    const decisionPacket = {
      id: `e2e-exec-${Date.now()}`,
      issueId: "test-issue",
      recommendation: {
        action: "E2E Execute Test Action",
        rationale: "Testing execution flow",
        expectedOutcome: "Successful execution",
      },
      risks: [],
    };
    const { data: proposalData } = await fetchJson("/api/proposals", {
      method: "POST",
      body: JSON.stringify({ decisionPacket, proposer: "0xE2E_EXEC_TEST" }),
    });
    const execProposalId = proposalData.proposal.id;

    // Cast enough votes to pass (need 100 votes for quorum)
    for (let i = 0; i < 101; i++) {
      await fetchJson(`/api/proposals/${execProposalId}/vote`, {
        method: "POST",
        body: JSON.stringify({
          voter: `0xVOTER_EXEC_${i}_${Date.now()}`,
          choice: "for",
          weight: "1",
        }),
      });
    }

    // Finalize to pass
    const { data: finalizeData } = await fetchJson(`/api/proposals/${execProposalId}/finalize`, { method: "POST" });
    assert(finalizeData.proposal.status === "passed", `Proposal should pass after finalize, got: ${finalizeData.proposal?.status}`);

    // Execute
    await testExecuteProposal(execProposalId);
  });

  // Delegation Tests
  let policyId: string | undefined;
  await runTest("Get Delegations", testGetDelegations);
  await runTest("Create Delegation", async () => {
    policyId = await testCreateDelegation();
  });
  if (policyId) {
    await runTest("Get Delegation", async () => {
      await testGetDelegation(policyId!);
    });
    await runTest("Revoke Delegation", async () => {
      await testRevokeDelegation(policyId!);
    });
  }
  await runTest("Check Delegation", testCheckDelegation);

  // Full Workflow Test
  await runTest("Full Workflow", testFullWorkflow);

  // Summary
  console.log("\n" + "=".repeat(50));
  console.log("\n📊 Test Summary\n");

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

  console.log(`Total: ${results.length} tests`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`⏱️  Duration: ${totalDuration}ms\n`);

  if (failed > 0) {
    console.log("Failed Tests:");
    results
      .filter((r) => !r.passed)
      .forEach((r) => {
        console.log(`  - ${r.name}: ${r.error}`);
      });
  }

  console.log("\n" + "=".repeat(50) + "\n");

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(console.error);
