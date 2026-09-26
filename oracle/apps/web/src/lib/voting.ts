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
export const VOTING_ENABLED = ["1", "true", "yes", "on"].includes(
  (process.env.NEXT_PUBLIC_VOTING_ENABLED ?? "").trim().toLowerCase(),
);

// Where Mossland DAO votes and delegates.
export const AGORA_URL = "https://agora.moss.land";
