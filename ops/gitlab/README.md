# Local GitLab CI/CD

This directory bootstraps a local GitLab CE instance on Docker Desktop and a matching runner topology for `tnyma-ai` + `tnyma-ai-installer`.

## 1. Start GitLab on Docker Desktop

```bash
cd ops/gitlab
cp gitlab.env.example gitlab.env
docker compose --env-file gitlab.env up -d
```

By default, GitLab data is persisted under `/Volumes/docker/GitLab`.

Wait for `http://gitlab.local:8929` or your chosen LAN hostname to finish booting.

If the host machine has `HTTP_PROXY` / `HTTPS_PROXY` configured, add the GitLab LAN hostname or IP to `NO_PROXY` before validating browser or CLI access. Otherwise local proxy software may return a false `502` even when GitLab itself is healthy.

For a lightweight local instance, this compose file also applies the memory-constrained GitLab tuning from the official GitLab docs:

- Puma single-process mode
- Sidekiq concurrency pinned to `10`
- Prometheus and related exporters disabled
- jemalloc decay tuning for Rails and Gitaly
- explicit `linux/amd64` runtime on Apple Silicon hosts

To make the instance default to Chinese after the container is healthy:

```bash
cd ops/gitlab
./configure-instance.sh
```

The script applies `default_preferred_language=zh_CN` to the instance and also updates the root user's preferred language.

To create a manual GitLab backup snapshot:

```bash
cd ops/gitlab
./backup.sh
```

## 2. Import the two repositories

Create a GitLab group for your local deployment, then import:

- `tnyma-ai`
- `tnyma-ai-installer`

Recommended ownership model:

- GitLab becomes the primary remote
- GitHub remains upstream/reference only
- `tnyma-ai-installer` consumes `tnyma-ai` by URL + ref in CI

Set the installer project CI/CD variable:

- `TNYMA_AI_GIT_URL=http://<gitlab-host>:8929/<group>/tnyma-ai.git`

Optional variables:

- `TNYMA_AI_REF=main`
- `SKIP_OPENCLAW_NPM_VERIFY=0`

For tag releases, set `TNYMA_AI_REF` to an immutable commit SHA or tag instead of `main`.

## 3. Register runners

### Docker runner for generic jobs

Start the optional runner container:

```bash
cd ops/gitlab
docker compose --env-file gitlab.env --profile docker-runner up -d gitlab-runner
```

Register it with the `docker` tag:

```bash
docker exec -it local-gitlab-runner gitlab-runner register \
  --non-interactive \
  --url http://gitlab.local:8929 \
  --token <project-or-group-runner-token> \
  --executor docker \
  --docker-image node:20-bookworm \
  --description docker-runner \
  --tag-list docker \
  --run-untagged=false \
  --locked=false
```

### macOS shell runner

Install and register on the macOS host:

```bash
brew install gitlab-runner
sudo gitlab-runner install
sudo gitlab-runner start
sudo gitlab-runner register \
  --non-interactive \
  --url http://gitlab.local:8929 \
  --token <project-or-group-runner-token> \
  --executor shell \
  --description macos-shell-runner \
  --tag-list macos \
  --run-untagged=false \
  --locked=false
```

### Windows shell runner

Install `gitlab-runner.exe` inside the Parallels Windows VM and register it with the `windows` tag.

Set runner-local prerequisites:

- Git for Windows
- Node + Corepack
- pnpm via Corepack
- any Windows signing material if you later add code signing

### Ubuntu shell runner

Install GitLab Runner inside the Parallels Ubuntu VM and register it with the `linux` tag.

Set runner-local prerequisites:

- `git`
- `tar`
- Node + Corepack
- `pnpm`
- any packaging dependencies required by `electron-builder`

## 4. Pipeline behavior

The installer repo `.gitlab-ci.yml` is designed as follows:

- `notify:build:feishu` as a non-blocking build notification job
- `verify:installer` on the `docker` runner
- `bundle:services` on the `docker` runner
- `package:mac` on the `macos` runner
- `package:win` on the `windows` runner
- `package:linux` on the `linux` runner
- `release:gitlab` on tags
- `notify:release:feishu` as a non-blocking release notification job

On tag pipelines, `release:gitlab` now:

- uploads the packaged installers into the GitLab Generic Package Registry
- creates or updates a GitLab Release page for that tag
- attaches permanent release download links under the release asset list
- generates release notes from the commits between the previous tag and the current tag

The resulting release page behaves more like a GitHub Releases page: each version has a changelog plus stable per-file download URLs.

Tag pipelines also enforce release inputs:

- the Git tag must match `package.json.version`
- `TNYMA_AI_REF` must be a commit SHA or version tag, not a floating branch
- `package:mac` must have valid notarization credentials
- package artifacts expire after `14 days`, while release notes stay for `180 days`

### Feishu CI notifications

The pipeline supports two optional Feishu bots:

- build bot: sends a message after cross-platform packaging succeeds
- release bot: sends a success message with the GitLab Release page and download links, and also sends a failure message when a tag release pipeline fails

Recommended CI/CD variables:

- `FEISHU_BUILD_BOT_APP_ID`
- `FEISHU_BUILD_BOT_APP_SECRET`
- `FEISHU_BUILD_BOT_CHAT_ID` or `FEISHU_BUILD_BOT_CHAT_NAME`
- `FEISHU_RELEASE_BOT_APP_ID`
- `FEISHU_RELEASE_BOT_APP_SECRET`
- `FEISHU_RELEASE_BOT_CHAT_ID` or `FEISHU_RELEASE_BOT_CHAT_NAME`

If `*_CHAT_ID` is not set, the notifier tries to resolve the target by chat name. If no chat name is set either, it falls back to auto-selecting the only chat visible to that bot.

### macOS notarization in CI

For tag releases, `package:mac` now requires notarization credentials. Supported credential layouts:

- `APPLE_KEYCHAIN_PROFILE` (optionally with `APPLE_KEYCHAIN`) for a macOS runner that already has a saved `notarytool` profile
- `APPLE_API_KEY` + `APPLE_API_KEY_ID` + `APPLE_API_ISSUER`
- `APPLE_API_KEY_BASE64` + `APPLE_API_KEY_ID` + `APPLE_API_ISSUER`
- `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID`

On this workstation, the `macos` runner delegates to [`package-mac.sh`](../../package-mac.sh), which can load the local signing environment and submit DMGs with `xcrun notarytool`.

After packaging, the job validates:

- `codesign --verify --deep --strict`
- `spctl --assess`
- `xcrun stapler validate`

Packaging jobs resolve `tnyma-ai` from either:

- an existing local checkout via `TNYMA_AI_SOURCE_ROOT`
- or a CI clone via `TNYMA_AI_GIT_URL` + `TNYMA_AI_REF`

## 5. TnymaAI release policy

`tnyma-ai-installer` always packages the `TnymaAI` npm dependency declared in its own `package.json`.

CI verifies that:

- the declared `TnymaAI` version exists on npm
- the packaged build metadata records the installer version, `TnymaAI` version, and bundled `tnyma-ai` revision

## 6. Optional second repo pipeline

A starter pipeline for the `tnyma-ai` repo is included at:

- `ops/gitlab/templates/tnyma-ai.gitlab-ci.yml`

Copy that file into the root of the `tnyma-ai` repository when you are ready to enable CI there too.
