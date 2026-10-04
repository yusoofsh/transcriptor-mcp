# ADR 007: Keep one feature implementation behind both protocol transports

Status: accepted for the fork's Events reconciliation.

The synchronized upstream owns the eight video tools, prompts, widget resources, validation, queueing, transcript behavior and user-facing errors. The fork adds authenticated, reference-only Events. A manual modern HTTP dispatcher forwarded tools only and answered discovery or Events before the complete modern request validation ladder. That duplicated protocol behavior and silently removed the resource/prompt surface.

Use the maintained MCP server SDK's `createMcpHandler` entrypoint for modern requests and its official request classifier for the routing boundary. Forward tools, resources, resource templates and prompts to the existing server through an in-memory MCP connection, preserving metadata and cancellation. Register Events as an extension on the modern server. The SDK validates the modern envelope, protocol version and method/name headers before invoking any extension callback. Existing legacy HTTP and stdio paths remain.

This does not add an unauthenticated remote deployment option. Production still requires the existing OAuth ingress and the real single-owner authorization checker before Events can be enabled. No secret values or production locations are committed. Events stay disabled without their complete runtime configuration. Fixture and image checks prove protocol behavior, not live ChatGPT callback delivery.

Always fetch and compare the registered upstream before a maintenance release. Preserve upstream and fork ancestry with a merge; keep tests for both. Do not replace the fork with upstream or reintroduce the older vulnerable lockfile while merging the Events branch.
