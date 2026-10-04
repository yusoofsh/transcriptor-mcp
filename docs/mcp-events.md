# MCP Events

`transcript.completed` reports successful background Whisper jobs. Optional string filters are `url` and `language`; payloads contain only `url`, `language`, and `format`. Read transcript content through the existing authenticated tools.

## Configuration

Set `MCP_EVENTS_STATE_KEY` to 64 hex characters (32 random bytes), `MCP_EVENTS_PRINCIPAL` to the authenticated ingress owner, and optionally `MCP_EVENTS_STATE_PATH` (default `/data/events/state.enc`). The encrypted state file must be private and must not be shared between processes.

Delivery requires `MCP_EVENTS_AUTH_CHECK_URL` (HTTPS) and secret `MCP_EVENTS_AUTH_CHECK_TOKEN`. The checker receives authenticated POST JSON `{ "principal": "<configured owner>" }` and must return `{ "authorized": true }` only while that owner retains access. This connects the existing external OAuth ingress to delivery authorization; errors, revocation, and expiry stop delivery. Configuring a state key without this checker fails startup. With no key, event capabilities are disabled.

## Delivery

`events/list`, `events/subscribe`, and `events/unsubscribe` accompany modern `server/discover`. Callbacks use public HTTPS on port 443, fresh DNS validation, pinned connections, TLS hostname verification, and no redirects. Callback verification has a ten-second deadline. Standard Webhooks HMAC-SHA256 signatures cover the exact body bytes, with stable event IDs across retries and fresh signing timestamps. Receivers must deduplicate event IDs. A 410 removes the subscription; 413 and permanent client errors stop retries. Receipts are limited to 16 KiB and event bodies to 256 KiB.

Subscription and pending delivery state is encrypted and atomically persisted. Leases are finite, at most 24 hours. `cursor:null` means no historical replay. Refresh subscriptions before `refreshBefore`; secret rotation retains the previous signing key for five minutes.

## Verification and rollout

Local tests use test callback receipts and real MCP transports. These checks do not establish production ChatGPT callback delivery. Deployment also requires the ingress authorization checker, runtime secrets, a persistent state volume, plugin rescan, and a real subscription/callback check including refresh, unsubscribe, revocation, and restart recovery.

Reference: https://developers.openai.com/plugins/build/mcp-events
