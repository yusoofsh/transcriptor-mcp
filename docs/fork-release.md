# Fork release and verification

The maintained fork baseline is Node 24 LTS, minimum 24.9. Install dependencies using the committed npm lockfile. The former Node 22 instructions in inherited upstream prose are superseded for this fork by this document and `package.json`.

The CI workflow checks formatting, lint, types, the full non-live test suite and build. High or critical runtime npm advisories fail the gate. The current refresh clears runtime findings; three development-only advisory entries remain through the widget build plugin's `micromatch`/`braces` chain. No forced downgrade or vulnerability suppression was applied. npm findings do not cover the complete operating-system image or the optional media tools.

A Node 24 candidate is built once and checked as a non-root user, with networking disabled, no saved accounts, a read-only root filesystem and no extra capabilities. The packaged stdio server must expose all eight tools, resources and prompts. The packaged HTTP app must pass health, method rejection, initialization and tool discovery checks. These tests do not transcribe a live video or verify production OAuth, Events, YouTube connectivity or account behavior.

Only current-main runs can publish the exact tested image as `ghcr.io/yusoofsh/transcriptor-mcp:latest`. The runtime source label must match the commit; no rebuild occurs between verification and promotion. Pull requests verify local candidate images without registry login or publication. No upstream Docker Hub or MCP Registry target is used. The separate REST Docker stage is retained but this workflow publishes only the MCP target.

The inherited website deployment is opt-in using the non-secret repository variable `ENABLE_SITE_DEPLOY=true`. Existing Cloudflare account/token secret names and the Pages target are unchanged. This work does not create credentials, enable the variable, or deploy the website. A skipped opt-in job must not be reported as a successful deployment.

The one-time dependency-preparation workflow is removed after it generated and validated the manifests; normal CI has no repository-content write permissions. Production rollout is separate from image publication and must preserve the ingress boundary and state volumes.
