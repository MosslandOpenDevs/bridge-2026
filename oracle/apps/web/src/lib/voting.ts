// Whether BRIDGE offers its own voting and delegation UI.
//
// Off by default. Mossland DAO votes on Agora, BRIDGE's proposals are
// non-binding, and no vote or delegation was ever recorded here; the API
// refuses both writes with 410 unless its own VOTING_ENABLED is on. Showing a
// wallet button and a vote form the server will refuse only suggests that
// decisions are made here.
//
// Next inlines NEXT_PUBLIC_* at build time, so changing this needs a rebuild,
// and it should be turned on together with the API's VOTING_ENABLED.
//
// Parsed exactly like the API's envFlag, including refusing anything it does
// not recognise. Reading a typo ("ture", "enabled") as off would ship a build
// with the voting UI hidden while the API accepts votes, and nothing would say
// so. next.config.js applies the same check so `next build` fails on such a
// value; the throw below only backs that up.
function parseVotingFlag(raw: string | undefined): boolean {
  if (raw === undefined || raw === "") return false;
  const value = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  throw new Error(
    `NEXT_PUBLIC_VOTING_ENABLED must be a boolean (1/0, true/false, yes/no, on/off), got "${raw}"`,
  );
}

// The literal `process.env.NEXT_PUBLIC_VOTING_ENABLED` access is what Next
// replaces at build time; keep it spelled out here.
export const VOTING_ENABLED = parseVotingFlag(process.env.NEXT_PUBLIC_VOTING_ENABLED);

// Where Mossland DAO votes and delegates.
export const AGORA_URL = "https://agora.moss.land";
