# Arcium Local Reference Pack

This folder is a lightweight local snapshot of the most useful official Arcium AI-readable docs for `shadowperp`.

## Files

- `llms.txt`
  Use this first for discovery. It is the compact index of the official Arcium docs.
- `skill.md`
  The official Arcium AI-agent guidance. Good for workflows, gotchas, and build/callback mental models.
- `llms-full.txt`
  The large full-docs dump. Use only when the smaller files are not enough.

## Recommended Read Order

1. `llms.txt`
2. `skill.md`
3. specific linked docs from `llms.txt`
4. `llms-full.txt` only for deep fallback

## ShadowPerp Notes

- For this repo, the most important Arcium topics are:
  - callback output type generation
  - ArgBuilder input ordering
  - `Enc<Shared, T>` vs `Enc<Mxe, T>`
  - rebuild discipline after circuit return-type changes
  - shielded callback/account wiring
- The May 2026 shared-secret caching optimization is primarily a compiler/node-side Arcium feature.
  Rebuild with a current Arcium release to benefit from it; do not assume it requires a frontend rewrite.

## Upstream Sources

- `https://docs.arcium.com/llms.txt`
- `https://docs.arcium.com/skill.md`
- `https://docs.arcium.com/llms-full.txt`
