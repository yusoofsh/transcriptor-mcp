# Durable transcript Tasks

The optional runtime augments `get_transcript` and `get_playlist_transcripts` only when the client declares `io.modelcontextprotocol/tasks`. Existing synchronous tools are the fallback for other clients. The released native SDK validates task routing; no HTTP interception or legacy-registry workaround is used.

Set `MCP_TASKS_DB_PATH` to a file in a private persistent directory to enable the runtime. Leave it unset to retain existing behavior. The runtime also requires the existing single-owner ingress principal, encryption key and real HTTPS authorization checker. It does not configure an ingress or create credentials. Do not expose its listener publicly or use it as a multi-user server.

A job is persisted before its handle is returned. One invocation of the existing tool runs independently of the request connection, through the existing provider queues and validation. No additional caption retry, proxy/cookie fallback or parallel fan-out is introduced. If the existing tool itself returns a pending provider job, that is still its exact result; the task layer does not poll or restart the provider implicitly.

The SQLite store uses private file/directory permissions, encrypted argument/result payloads, a 24-hour retention limit, at most eight active and 64 retained tasks per owner, a two-MiB payload limit and a bounded database page count. A transaction claims at most one queued task for that owner. Workers renew leases while working; an abandoned running attempt becomes failed with an unknown-outcome message rather than being replayed. Queued, never-started work can resume after a process restart.

`tasks/get`, `tasks/update` and `tasks/cancel` require client capability declaration and current authorization. Task IDs are not bearer credentials. Another owner cannot read a task. Cancellation is cooperative: it can prevent queued execution and signal active work, but cannot undo provider work. This runtime currently requests no interactive task inputs; unknown response keys sent to tasks/update are ignored after authorization and task validation.

Authorization is rechecked before execution, on every status/control request and during work. Trace metadata is restricted to the existing validated traceparent projection; credentials and arbitrary baggage are not persisted. The runtime uses no host-provided callback and does not claim Events notification delivery.

The source and image tests use synthetic providers, temporary private state and no production account. Real deployment still needs an identified owned endpoint, durable volume, authorization checker and acceptance checks. A passing image is not proof that the installed connector points to that image.
