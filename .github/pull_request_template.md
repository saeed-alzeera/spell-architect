## What and why

<!-- What changed, and the reason. -->

## Checklist

- [ ] `npm run typecheck` passes
- [ ] Gameplay/balance change? `version` bumped in `package.json` and `package-lock.json`
- [ ] Touched `src/net/` or the wire format? Co-op tested and protocol version bumped if needed
- [ ] Touched `worker/`? `node --test worker/mp.test.mjs worker/runs.test.mjs` passes
- [ ] Docs (`AGENTS.md`, `README.md`, `docs/`) updated if they went stale
