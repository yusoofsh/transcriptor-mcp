# Workflow runtime

The modern tool catalog adds `open_subtitle_viewer`; all eight original tools remain unchanged. Its static MCP Apps resource is `ui://transcriptor/subtitle-reader-v1.html`. Desktop file entrypoints accept SRT/WebVTT descriptors, not filesystem paths. File bytes are read through the host only after an explicit reload action. Other hosts can use local file selection or pasted text; these stay inside the view and are not uploaded. Payload markup is rendered as text. Parsing is bounded to one megabyte, 5000 valid cues, 8000 characters per cue, and 300 displayed matching cues. Malformed input remains visible as a coverage warning and does not alter the original file.

The viewer can follow host-managed file update notifications, which mark the view stale and require explicit reload. This is not server-side subscriptions/listen, durable replay, or proof of an Events callback lifecycle. Context sharing occurs only after selecting a cue and clicking its context action. Time units are a view-local choice, not native persistent plugin settings.

Two bounded Skills manifests include complete resource lists and exact UTF-8 digests. Packaged Markdown is exported from the same definitions. OpenAI imports remain submission-time snapshots. Legacy stdio/HTTP tools stay available; modern skill methods and the viewer do not imply that a legacy client supports them.

Compatibility calls preserve application metadata and forward validated traceparent identifiers while dropping arbitrary baggage/tracestate. Cacheable private results use zero freshness by default. These changes are not an end-to-end tracing exporter, cache backend, authorization replacement, or Tasks implementation.

Durable-job implementation and production endpoint discovery were not completed in this pass. The server must not advertise native Tasks, new service credentials, new stream semantics, or historical event replay from this code. Keep the current real ingress and authorization checker requirements; no deployment endpoint, checker or callback is fabricated. WAMCP remains excluded.
