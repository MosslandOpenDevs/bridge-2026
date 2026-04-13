import { ethers } from "hardhat";

/**
 * Deploy script for OracleGovernance + OracleToken.
 *
 * Role separation: the deployer EOA is used only to configure roles, then
 * renounces everything except DEFAULT_ADMIN_ROLE. This prevents a single-key
 * compromise from being able to both vote (ORACLE_ROLE) and execute
 * (EXECUTOR_ROLE).
 *
 * Env vars:
 *   ORACLE_ADDRESS   - EOA/contract that casts votes & records outcomes (required in prod)
 *   EXECUTOR_ADDRESS - EOA/contract that executes passed proposals (optional, defaults to deployer)
 *   PAUSER_ADDRESS   - Emergency pauser (optional, defaults to deployer)
 *   PROPOSER_ADDRESS - Who can create proposals (optional, defaults to deployer)
 *   RENOUNCE_DEPLOYER_ROLES - "true" to drop deployer's operational roles after grant
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  const oracleAddress = process.env.ORACLE_ADDRESS || deployer.address;
  const executorAddress = process.env.EXECUTOR_ADDRESS || deployer.address;
  const pauserAddress = process.env.PAUSER_ADDRESS || deployer.address;
  const proposerAddress = process.env.PROPOSER_ADDRESS || deployer.address;
  const renounce = (process.env.RENOUNCE_DEPLOYER_ROLES || "false").toLowerCase() === "true";

  const isMainnet = network.chainId === 1n;
  if (isMainnet && !process.env.ORACLE_ADDRESS) {
    throw new Error(
      "Refusing mainnet deploy without ORACLE_ADDRESS — deployer key must not also be the oracle key.",
    );
  }

  console.log(`\n📡 Network: ${network.name || "unknown"} (chainId=${network.chainId})`);
  console.log(`👤 Deployer: ${deployer.address}`);
  console.log(`🔑 Roles:`);
  console.log(`   ORACLE    → ${oracleAddress}`);
  console.log(`   EXECUTOR  → ${executorAddress}`);
  console.log(`   PAUSER    → ${pauserAddress}`);
  console.log(`   PROPOSER  → ${proposerAddress}`);
  console.log(`   Renounce deployer operational roles: ${renounce}\n`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`💰 Deployer balance: ${ethers.formatEther(balance)} ETH`);
  if (balance === 0n) {
    throw new Error("Deployer has 0 ETH — fund the account before deploying.");
  }

  // 1. OracleToken — useful on testnet as a MOC stand-in; owner holds initial supply.
  const OracleToken = await ethers.getContractFactory("OracleToken");
  const token = await OracleToken.deploy(deployer.address);
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();
  console.log(`\n✅ OracleToken deployed:   ${tokenAddress}`);

  // 2. OracleGovernance
  const OracleGovernance = await ethers.getContractFactory("OracleGovernance");
  const governance = await OracleGovernance.deploy();
  await governance.waitForDeployment();
  const governanceAddress = await governance.getAddress();
  console.log(`✅ OracleGovernance deployed: ${governanceAddress}`);

  // 3. Grant roles to the intended holders (idempotent — no-op if already granted).
  const ORACLE_ROLE = await governance.ORACLE_ROLE();
  const EXECUTOR_ROLE = await governance.EXECUTOR_ROLE();
  const PAUSER_ROLE = await governance.PAUSER_ROLE();
  const PROPOSER_ROLE = await governance.PROPOSER_ROLE();

  const grants: Array<{ role: string; roleHash: string; to: string }> = [];
  if (oracleAddress.toLowerCase() !== deployer.address.toLowerCase()) {
    grants.push({ role: "ORACLE_ROLE", roleHash: ORACLE_ROLE, to: oracleAddress });
  }
  if (executorAddress.toLowerCase() !== deployer.address.toLowerCase()) {
    grants.push({ role: "EXECUTOR_ROLE", roleHash: EXECUTOR_ROLE, to: executorAddress });
  }
  if (pauserAddress.toLowerCase() !== deployer.address.toLowerCase()) {
    grants.push({ role: "PAUSER_ROLE", roleHash: PAUSER_ROLE, to: pauserAddress });
  }
  if (proposerAddress.toLowerCase() !== deployer.address.toLowerCase()) {
    grants.push({ role: "PROPOSER_ROLE", roleHash: PROPOSER_ROLE, to: proposerAddress });
  }

  for (const { role, roleHash, to } of grants) {
    const tx = await governance.grantRole(roleHash, to);
    await tx.wait();
    console.log(`   granted ${role} to ${to}`);
  }

  // 4. Optionally renounce deployer's operational roles so a single leaked deploy key
  //    can't vote/execute/pause. DEFAULT_ADMIN_ROLE is kept so the deployer can still
  //    rotate roles later (move that to a multisig in prod).
  if (renounce) {
    const operationalRoles: Array<{ name: string; hash: string; recipient: string }> = [
      { name: "ORACLE_ROLE", hash: ORACLE_ROLE, recipient: oracleAddress },
      { name: "EXECUTOR_ROLE", hash: EXECUTOR_ROLE, recipient: executorAddress },
      { name: "PAUSER_ROLE", hash: PAUSER_ROLE, recipient: pauserAddress },
      { name: "PROPOSER_ROLE", hash: PROPOSER_ROLE, recipient: proposerAddress },
    ];
    for (const { name, hash, recipient } of operationalRoles) {
      if (recipient.toLowerCase() === deployer.address.toLowerCase()) {
        console.log(`   skipping renounce of ${name} — deployer is still the holder`);
        continue;
      }
      const tx = await governance.renounceRole(hash, deployer.address);
      await tx.wait();
      console.log(`   renounced ${name} from deployer`);
    }
  }

  // 5. Print final role assignments for the operator's records.
  const checks: Array<[string, string, string]> = [
    ["ORACLE_ROLE", ORACLE_ROLE, oracleAddress],
    ["EXECUTOR_ROLE", EXECUTOR_ROLE, executorAddress],
    ["PAUSER_ROLE", PAUSER_ROLE, pauserAddress],
    ["PROPOSER_ROLE", PROPOSER_ROLE, proposerAddress],
  ];
  console.log("\n🔍 Role verification:");
  for (const [name, hash, target] of checks) {
    const ok = await governance.hasRole(hash, target);
    console.log(`   ${ok ? "✓" : "✗"} ${target} has ${name}`);
  }

  console.log("\n────────────────────────────────────────────────────────");
  console.log("📋 Copy into apps/api/.env:");
  console.log(`RPC_URL=<same rpc you just deployed against>`);
  console.log(`CHAIN_ID=${network.chainId}`);
  console.log(`GOVERNANCE_CONTRACT_ADDRESS=${governanceAddress}`);
  console.log(`ORACLE_PRIVATE_KEY=<oracle EOA private key — NOT the deploy key>`);
  console.log("────────────────────────────────────────────────────────");
  console.log("📋 Etherscan verify (optional):");
  console.log(`  pnpm hardhat verify --network ${network.name || "sepolia"} ${governanceAddress}`);
  console.log(`  pnpm hardhat verify --network ${network.name || "sepolia"} ${tokenAddress} ${deployer.address}`);
  console.log("────────────────────────────────────────────────────────\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
