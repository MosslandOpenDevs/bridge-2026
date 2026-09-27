# Notes for coding agents

Read `CONTRIBUTING.md` first; everything there applies to you.

**This repository is public.** Files, commit messages, PR descriptions, PR and
review comments are all world-readable, and a merged commit message cannot be
taken back. Never write production host names, user names, home paths, IP
addresses (LAN, tailnet or public), open ports or firewall state into any of
them, even as evidence for a fix or copied from an audit. Use placeholders
(`<app-host>`, `<proxy-ip>`) or RFC 5737 addresses (`192.0.2.x`), describe the
condition in general terms, and leave the specifics in the private ops notes.
See "Deployment details stay private" in `CONTRIBUTING.md`.
