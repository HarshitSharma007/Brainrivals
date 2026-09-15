# BrainRivals on Render Free

**Status: source published; first Render deployment failed during tests on 2026-09-15.** The user made [HarshitSharma007/Brainrivals](https://github.com/HarshitSharma007/Brainrivals) public. The source and original GitHub README history were merged and pushed as `46438a4` without force-pushing. The user has created a Render service; no successful public deployment is confirmed yet.

The reported error was `Build the web app before starting with SERVE_WEB=1.` during online tests, before the web build. The room fixtures now explicitly disable static hosting; static-file tests supply their own temporary web build. Production startup still honors `SERVE_WEB=1` and rejects a missing build. Keep the existing test-before-build command and deploy the corrected commit. Complete any account authentication directly in your browser; do not send passwords, tokens, or verification links in chat.

**Fix validation (2026-09-15):** all **48 tests passed** from an empty working directory with `SERVE_WEB=1`, `NODE_ENV=production`, and the Render-style port/origin/room-cap variables, using the existing installed dependencies. `npm run build:render` then passed strict TypeScript, Vite/PWA, and backend compilation. A separate clean install with an empty npm cache was blocked by repeated `ERR_SSL_SSL/TLS_ALERT_HANDSHAKE_FAILURE` downloads from public npm on this machine and was stopped; clean network installation is not claimed as verified. No TLS security settings were weakened. Lockfile versions and integrity hashes were checked unchanged after mirror URL normalization. This follow-up fix has not yet been committed or pushed; publish it before selecting **Manual Deploy → Deploy latest commit** on the existing Free service.

## What gets hosted

One **Free Node Web Service** serves both the compiled game website and its Socket.IO room server. There is no database, paid disk, worker, or second frontend service. Android uses the same service URL for its backend.

The existing [render.yaml](render.yaml) explicitly sets `plan: free`, one instance, manual deployments, and `/health`. It has been validated locally against [Render's published schema](https://render.com/schema/render.yaml.json); this does not replace validation inside your Render account.

## 1. Connect a repository

1. Sign in to [Render](https://dashboard.render.com/) directly in the browser. Do not send passwords, access tokens, recovery codes, or API keys in chat.
2. Put this project in a GitHub/GitLab repository you control. A **private repository** is recommended; grant Render access only to that repository. If the assistant is doing the initial commit/push, explicitly authorize those operations and identify the destination first.
3. Keep the project at the repository root. Include [package.json](package.json), [package-lock.json](package-lock.json), source, tests, scripts, public assets, configuration, and [render.yaml](render.yaml). Respect [.gitignore](.gitignore): never upload `.tools`, `node_modules`, `.env`, keystores, or generated build folders. Do not upload the entire parent drive/folder through a browser.

## 2. Deploy the free service

In Render, select **New → Blueprint**, connect the repository, and review the proposed resources. The configuration creates only `brainrivals-beta` on the **Free** compute plan. Choose a different service name if you already have a service with that name; do not unintentionally update another service.

Before the first creation, choose a region near the test players. The blueprint omits `region`, so Render defaults to Oregon. For an India-based audience, consider setting `region: singapore` before creating the service. Region cannot be changed in place afterward.

Alternatively, choose **New → Web Service** and enter the equivalent settings manually:

| Field | Value |
| --- | --- |
| Source | Your authorized project repository and branch |
| Root directory | Empty when the project is at the repository root |
| Runtime | Node |
| Compute plan | **Free** |
| Instances | **1** |
| Build command | `npm ci --include=dev && npm test && npm run build:render` |
| Start command | `npm start` |
| Health check | `/health` |
| Auto-deploy | **Off** |

Set these environment variables (the Blueprint already contains them):

| Variable | Value |
| --- | --- |
| `NODE_VERSION` | `22` |
| `NODE_ENV` | `production` |
| `SERVE_WEB` | `1` |
| `MAX_ROOMS` | `100` |
| `ALLOWED_ORIGINS` | `https://localhost,http://localhost,capacitor://localhost` |

Render supplies `PORT` and `RENDER_EXTERNAL_URL`; do not copy a made-up public URL into either field. The server binds to `0.0.0.0` and automatically allowlists its exact `RENDER_EXTERNAL_URL`. `MAX_ROOMS=100` is a protective cap, **not a measured capacity guarantee** for free compute.

Leave `VITE_SERVER_URL` unset for this combined website: browser clients use the site's own origin. A custom web domain needs its exact HTTPS origin in `PUBLIC_ORIGIN` or `ALLOWED_ORIGINS`. Additional development origins must also be listed explicitly; no wildcard origins are required.

Review the plan and resources before clicking **Create/Deploy**. Do not enable a paid workspace, compute upgrade, preview service, or persistent disk for this free beta.

## 3. Connect the Android game

After Render reports a successful deploy, use the **actual URL displayed by Render**, such as `https://your-assigned-name.onrender.com` (example only, not a deployed address).

1. Open that URL in a browser. It should show BrainRivals, not a 404.
2. Open its `/health` path. Expect `{"ok":true}` once the service wakes up.
3. Install the updated [debug APK](android/app/build/outputs/apk/debug/app-debug.apk) on test devices.
4. On both phones, open **Settings → Online server address**, paste the same HTTPS origin with no `/health` or `/socket.io` suffix, then select **All set**.
5. Player one creates a room. Player two enters its six-character code. The host starts the match.

The client retries **only its initial connection** for up to 90 seconds, displays the cold-start notice, and supports cancellation. Room actions are not repeated automatically. A disconnect after joining still ends the room; no match resume or reconnection has been added.

For a later APK with the address built in, set `VITE_SERVER_URL` to the verified URL before running [scripts/android.ps1](scripts/android.ps1). Do not bake an unverified or placeholder URL into an APK. Runtime Settings override a build-time address.

## 4. Verify the actual deployment

- [ ] Render shows **Free**, one instance, a successful build, and a healthy `/health` endpoint.
- [ ] Two clients on different networks join the same room, receive the same shuffled question/options, and finish a match with identical scores.
- [ ] The first answer stays hidden until reveal; duplicate/late answers cannot add points. The guest cannot start/rematch.
- [ ] Native Android connects with its `https://localhost` origin and the actual public server URL.
- [ ] After a natural idle period, a new create/join attempt either connects within the retry window or shows a useful timeout. No artificial keep-alive service is configured.
- [ ] A deliberate redeploy/disconnect ends the room cleanly; users can create a new one afterward.
- [ ] Review usage/billing controls, intended audience, and [PRIVACY.md](PRIVACY.md); add actual operator/contact and hosting-log disclosures before a public launch or ads.

These checks remain open until run against a real public deployment. Local tests are not evidence of live Render behavior.

## Free-tier constraints

According to [Render's free-service documentation](https://render.com/docs/free), checked 2026-09-15:

- A service sleeps after 15 minutes without inbound traffic, including WebSocket messages. Waking can take about a minute. The first website visit may show Render's loading page before our app loads.
- Free services may restart at any time. All room state is in process memory, so restarts and deployments end active rooms. Automatic deploys are disabled to reduce avoidable interruption, not eliminate it.
- 750 free instance hours are shared by a workspace per month. Bandwidth and build allowances also apply. Exhaustion can suspend services/builds; accounts with payment methods may be billed for extra bandwidth/build usage. Review Render's controls before adding a card; do not assume selecting Free makes every possible account charge impossible.
- Use this for a small beta, not a reliability promise or a paid-ad launch. Do not use pingers to evade sleeping. No throughput/load test has established a supported player count.
- Keep one process/instance. A database or coordinated shared state would be needed before supporting restarts/resume or multiple servers.

## Local validation and troubleshooting

`npm run build:render` generates `dist/` and `dist-server/index.js`. `npm start` runs plain Node, not a development watcher; `tsx` is not needed at runtime. `npm ci --include=dev` is intentional because compilation needs development dependencies even with production environment variables.

Tests must also pass on a fresh checkout with `SERVE_WEB=1` and no `dist/` directory. Integration fixtures use `staticDir: false` for room-only servers; hosting tests use a temporary directory. A regression test verifies both that override and the unchanged production missing-build guard. [.npmrc](.npmrc) and the lockfile use public npm tarballs, with no self-referential `brainrivals: file:` dependency.

Locally, set `SERVE_WEB=1`, an unused `PORT`, and `PUBLIC_ORIGIN` to that local origin before `npm start`. No Render credentials are needed for this smoke test.

- **Homepage 404:** check `SERVE_WEB=1`, successful `build:render`, and repository-root settings.
- **Tests fail with "Build the web app before starting with SERVE_WEB=1":** deploy the test-isolation fix. Do not disable production web serving or remove tests from the build command. The same message from `npm start` still means the production web build is missing.
- **Room connection rejected:** use the correct HTTPS origin and verify native/custom-domain origins. Never fix this with a blanket `*` origin.
- **Room disappeared:** a restart, redeploy, disconnect, or 15-minute lobby expiration invalidates it. Create a new room; this beta does not restore matches.
- **Free resources unavailable or billing required:** stop and review the account's eligibility and usage; do not silently upgrade to a paid plan.