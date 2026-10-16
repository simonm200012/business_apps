# CLAUDE.md

## Start here
Read this repo's README (and HANDOFF.md) first. The cross-project handbook is the private repo `simonm200012/handbook` (START-HERE.md, MY-APPS-GUIDE.md); if this session can't open it, ask Simon.

## Save usage (Claude Max weekly limit)
- Pick helpers by task: `researcher` (Haiku) for lookups and reading; `builder` (Sonnet, the default) for building from patterns, redesigns, UI fixes, tests, docs, screenshots; `expert` (Opus) only for core architecture, security-sensitive work (sign-in, Access, secrets, sharing, deleting data or git history) or stubborn bugs.
- Fewer, narrower helpers. Offer 3 design options, not 6. Save big outputs to files. Keep the chat short.

## Cloud limits
- No Cloudflare login in the cloud. Deploy: `wrangler deploy` needs Simon's Mac or Workers Builds, so push the branch (`design-switch-recon`) and tell Simon. Never add personal data, e-mail addresses or secrets: this repo is PUBLIC.
- Secrets only via `npx wrangler secret put` typed by Simon; never in code, chat or commits.
- Simon picks looks from mockups; no glow. Show screenshots, and say what was and wasn't checked.
