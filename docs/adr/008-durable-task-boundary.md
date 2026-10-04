# 008. Durable Tasks preserve authorization and execution boundaries

Status: implemented; activation remains explicitly opt-in.

The old native SDK rejected tasks/get and tasks/cancel before extension handlers. Upstream fixed this in PR 2599. The released server 2.3.0 and node 2.1.1 packages are used with explicit method schemas; there is no HTTP interception workaround.

The modern factory creates a server per request. Task execution and durable state live outside that request lifecycle. Clients without Tasks capability keep synchronous tool results. Only get_transcript and get_playlist_transcripts are task-enabled, and they still call the original handlers. There is no additional caption retry, account fallback or proxy fan-out.

A job is persisted before its handle is returned. Encrypted SQLite state survives worker restart; a never-started queued job may resume. An abandoned running attempt fails with an unknown-outcome message instead of being replayed. The native update request reads reserved inputResponses from the SDK context after validation, not from parameters stripped by the SDK. Cancellation is cooperative and cannot undo completed provider work.

Source tests cover authorization, owner separation, scope, limits, file/key checks, lease exclusivity, cancellation and restart. The exact packaged image is additionally tested across a producer process and restarted worker process as a non-root user, with no network, production configuration or account. Existing stdio/HTTP image checks remain.

This does not activate a production service or create an authorization checker. A real deployment still requires the owned private endpoint, durable volume and existing ingress authorization contract. Settings and callbacks are not fabricated to obtain a successful activation result. The Tasks specification remains a versioned optional extension; unimplemented notification delivery is not advertised.
