# Signaling worker

Online co-op is peer-to-peer over WebRTC. This Cloudflare Worker only hands out
5-character room codes and relays the connection handshake (SDP offers/answers);
no game data passes through it. Routes are public: each room has its own random
host key and per-guest keys, and expires after two hours. Logic is in `mp.js`
(Durable Object `MPRoom`), tests in `mp.test.mjs`.

```bash
node --test worker/mp.test.mjs        # unit tests
cd worker && npx wrangler dev --local --port 8799   # local server (open the game with ?mp=http://localhost:8799)
```

Deployed by `.github/workflows/deploy-worker.yml` to
`https://spell-architect-mp.saeed-a-alzeera.workers.dev`. It needs the
`CLOUDFLARE_API_TOKEN` repository secret (and `CLOUDFLARE_ACCOUNT_ID` if the
token covers several accounts).

| Method | Path | |
| --- | --- | --- |
| POST | `/mp/rooms` | create a room -> `{ code, hostKey }` |
| GET | `/mp/rooms/:code` | `{ open, players, max, names }` |
| POST | `/mp/rooms/:code/join` | `{ name }` -> `{ peerId, peerKey }` (max 4 players) |
| POST | `/mp/rooms/:code/signal` | `{ as, key, to, kind, data }`, kind is offer / answer / ice / bye |
| GET | `/mp/rooms/:code/signal?as=&key=&after=&wait=` | long-poll the mailbox |
| POST | `/mp/rooms/:code/lock` | `{ key }` (host only): no new players, existing ones may reconnect |
| POST | `/mp/rooms/:code/close` | `{ key }` (host only) |
