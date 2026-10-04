# 008. Durable task results keep the current authorization and execution boundaries

Status: implementation in progress on this branch.

The core SDK 2.0.0 rejects native tasks/get and tasks/cancel before extension handlers. Upstream fixed that dispatch bug in PR 2599. The released server 2.3.0 and node 2.1.1 packages include the fix. Use those released packages and explicit schemas instead of an HTTP interception workaround.

The new SDK also enforces one server per connection and one stateless transport per request. Existing factories already build request-local servers. Regression tests must prove that this remains true before release.

A durable runtime must persist a job before returning its handle, keep its owner and argument boundaries, survive process restarts, bound storage and concurrency, and recheck authorization before polling or executing. It must not add caption retries, run parallel requests that bypass the existing provider queue, or automatically repeat an interrupted request whose outcome is unknown. Cancellation is cooperative and cannot undo provider work.

This branch must not advertise Tasks in production until durable storage, lifecycle and real-wire tests all pass. Existing synchronous tools and the legacy endpoint must remain available. Live deployment still requires the actual owned private endpoint and real ingress authorization checker. Do not invent credentials or a callback to claim activation.
