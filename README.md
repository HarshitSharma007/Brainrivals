# BrainRivals

**Think fast. Play together.** An Android-first, four-choice quiz game for friendly rivalry—not an IQ test.

React 19 · TypeScript 5.8 · Vite 6 · Capacitor 7 · Node.js / Socket.IO 4

**Android debug APK built on 2026-09-15:** the native build, APK signature/alignment checks, and packaged game-bundle check pass. The 2026-09-14 browser validation covers all three modes, offline loading, updates, and 39 passing tests. Physical Android testing, public hosting, release signing, and store publication remain separate steps.

**Render Free beta prepared on 2026-09-15:** 47 tests pass; a combined website/room server and cancelable cold-start handling are ready. [RENDER.md](RENDER.md) contains the deployment steps. **No public service is deployed yet**: the user supplied a private GitHub repository and verified their Render email; authenticated repository access and Render sign-in are still required here.

**Test APK:** [android/app/build/outputs/apk/debug/app-debug.apk](android/app/build/outputs/apk/debug/app-debug.apk) (4.26 MB), rebuilt with cold-start handling. This is debug-signed for testing, not a Play Store release.

## Play your way

- **One phone, two players:** simultaneous offline answers with mirrored tabletop controls; Player 2 faces the opposite direction. Switch to side-by-side when preferred.
- **You vs. Byte:** an offline, rule-based computer opponent with randomized accuracy and response delays. No remote AI service.
- **Private online rooms:** share a six-character code with one friend using the same running backend. Exactly two players; the host starts matches and rematches. No public matchmaking or reconnect/resume.
- **Question Lab:** explore all 90 original questions and reveal their answers and explanations. There are 30 each in `general`, `puzzles`, and `reasoning`, with 10 easy, 10 medium, and 10 hard labels per category.
- **Personal touches:** local progress, generated game sounds, optional Android haptics, sound mute, reduced motion, and labeled answer controls with text/icons as well as color. Assets and sounds do not depend on external CDNs.

“IQ challenge” is a theme only. BrainRivals does not provide validated IQ scores or claim to sharpen IQ, improve cognitive health, or measure intelligence.

## Rules at a glance

- Choose **5, 10, or 15 rounds**, one category or `mixed`. Mixed selection is balanced: category counts differ by at most one, with extra slots assigned randomly. Questions are unique within a match; questions and answer options are shuffled.
- Each round has a **3-second countdown**, **15-second answer window**, and **4-second reveal** with an explanation. Reveal begins early if both players answer.
- One answer per player per question; answers cannot be changed. Both players can score. Rematches are free; there are no extra attempts within a round.
- A valid correct answer earns $1{,}000 + \operatorname{round}(500 \times (1 - \text{elapsedMs}/15{,}000))$ points, using `Math.round`: **1,000 base + at most 500 speed points**. Wrong, unanswered, and late answers earn **0**. Live handlers reject submissions at or after the deadline.
- Highest total wins; equal scores are a draw. Average response time uses correct answers only.

| Byte setting | Correct-answer probability per question | Scheduled response delay |
| --- | --- | --- |
| Chill (`easy`) | 55% | 4–10 seconds |
| Balanced (`medium`) | 75% | 2.5–7 seconds |
| Sharp (`hard`) | 90% | 1.3–4.5 seconds |

These are randomized targets, not guaranteed match accuracy. **Bot difficulty does not filter question difficulty.** Rules and content live in [src/shared/rules.ts](src/shared/rules.ts), [src/shared/types.ts](src/shared/types.ts), and [src/shared/questions.ts](src/shared/questions.ts).

## Run locally

Use a supported Node.js release compatible with the dependencies (Node.js 22 LTS is a suitable baseline) and npm. No additional VS Code extensions are required. From the project root:

| Command | Purpose |
| --- | --- |
| `npm install` | Install dependencies. |
| `npm run assets` | Generate and dimension-check 18 branded web/native PNG icons from the original SVG. Also runs before every build. |
| `npm run dev` | Start the backend on **3001** and Vite on **5173** together. |
| `npm test` | Run the shared-rule and Socket.IO integration tests. |
| `npm run build` | Type-check and generate the production web bundle/service worker. Does not build a native APK/AAB or package the backend. |
| `npm run preview` | Inspect the built frontend locally, normally on **4173**; does not start the backend. Not production hosting. |
| `npm run server` | Run the backend separately. |
| `npm run build:render` | Build the website and compile the backend to `dist-server/index.js`. |
| `npm start` | Run the compiled Node backend; `SERVE_WEB=1` also serves `dist/` at the same origin. |

Open [the local app](http://localhost:5173). Vite proxies `/socket.io` (including WebSockets) and `/health` to `http://127.0.0.1:3001`. For online testing in preview, start the backend separately and allow the actual preview origin. See [package.json](package.json) and [vite.config.ts](vite.config.ts).

**VS Code tasks:** use **Terminal → Run Task** for play locally, build web, test, install local Android tools, check Android tools, or build Android debug APK. **Ctrl+Shift+B** runs the web build. The six tasks are defined in [.vscode/tasks.json](.vscode/tasks.json). No extra editor extensions are required.

**Offline availability:** browser offline play requires an initial online visit to the **production build**, successful service-worker installation, and completed asset caching. Development mode is not an offline-service-worker test. Clearing or evicting browser caches requires another online visit. Native builds bundle the web assets for same-phone and Byte play in airplane mode; physical-device validation remains pending. Online rooms always require connectivity.

Available web updates show an **Update & reload** action outside active matches; they do not force a reload mid-match. Native Android uses bundled assets instead of registering the web service worker.

For a quick phone browser test, open the Network URL printed by Vite while both devices can reach the same LAN. Firewall/network isolation may prevent access. Same-phone and Byte modes work on ordinary HTTP LAN addresses; browser installation/offline caching requires HTTPS (or localhost on the development machine). Online LAN clients also need their exact browser origin in `ALLOWED_ORIGINS` before the server starts. Do not mistake a LAN address for public hosting.

## Online configuration and hosting

**No cloud backend is deployed.** [render.yaml](render.yaml) prepares one free Node web service for both the website and Socket.IO backend. See [RENDER.md](RENDER.md) for the Git account handoff, exact settings, cold-start caveats, and live verification checklist. Shipping a bundle or APK does not create that service. Render provides TLS; keep WebSocket and polling support enabled.

| Setting | Actual behavior |
| --- | --- |
| Settings → Online server address | Runtime override saved on this device. Takes precedence over the build-time URL. |
| `VITE_SERVER_URL` | Vite **build-time** frontend value. Changing it on a host after building does not change the bundle; rebuild/resync or use Settings. |
| `PORT` | Backend process variable; default `3001`. |
| `ALLOWED_ORIGINS` | Backend process variable; comma-separated explicit origins. An override replaces the local defaults. No wildcards or URL paths. |
| `RENDER_EXTERNAL_URL` | Supplied by Render; its exact origin is automatically added to the allowlist. Not taken from request headers. |
| `PUBLIC_ORIGIN` | Optional additional exact web origin, e.g. a custom HTTPS domain. |
| `SERVE_WEB` | Set to `1` to serve only compiled files from `dist/`, alongside `/health` and Socket.IO. Startup fails if the web build is absent. |
| `MAX_ROOMS` | Backend process variable; default `1000` live rooms. |

Server addresses must be origins such as `https://play.example.com`, without paths, credentials, queries, or fragments. With neither URL configured, browsers use their own origin (the local proxy during development). **Native Android requires an explicit reachable HTTPS backend** through Settings or the build-time value; localhost on a phone is not your development computer.

For `ALLOWED_ORIGINS`, include the real hosted frontend origin and **`https://localhost` for Capacitor Android**. Include `http://localhost:5173` and `http://127.0.0.1:5173` when supporting local development, and the actual preview origin when needed. Built-in defaults additionally include `http://localhost` and `capacitor://localhost`. List only origins you intend to support.

**Environment-file trap:** [.env.example](.env.example) is a reference, not a backend loader. Vite can read its environment files, but the server reads **only `process.env`** and does **not automatically load dotenv files**. Supply backend variables through the launching shell or host. Development `npm run server` needs `tsx`; production `npm start` uses the compiled backend and only runtime dependencies after `build:render`. No environment value prefixed `VITE_` is secret—it can be embedded in the downloadable client.

### Authority, fairness, and operating limits

- The server selects questions, associates players with sockets, accepts one answer each, controls phase deadlines, and calculates scores from **server receipt time**. Client timestamps/scores are not trusted. The displayed clock is an estimate; network latency affects speed points and deadlines, with no latency compensation.
- `publicQuestion()` omits the key and explanation until reveal. **This prevents premature answer-key leakage through the online protocol, not cheating:** the same full bank is downloadable and exposed in Question Lab. Option shuffling does not make it secret. This is not anti-cheat protected or esports-secure.
- Disconnecting or leaving ends the room for both players; there is no reconnect grace period. Idle lobbies and finished rooms expire after 15 minutes. Restarting the server loses all rooms.
- Initial connections can retry for up to 90 seconds to tolerate a sleeping free host, with cancellation. This does not retry room actions or resume disconnected matches. A first website visit may wait on Render's own startup page before the app loads.
- Rooms are **single-process, in-memory** state: no durable database, failover, or multi-instance coordination. Shared state/routing and scaling are future deployment work.
- The backend has a 16 KiB message limit, 40 events per socket per 10 seconds, and a room cap. These are basic safeguards, **not DDoS protection**. Origin checking is not authentication; requests without an Origin header are accepted. Room codes are invitations, not verified identities.

Implementation: [server/index.ts](server/index.ts), [src/lib/online.ts](src/lib/online.ts), and [src/game/localMatch.ts](src/game/localMatch.ts).

## Android packaging

**Java 21 and the Android SDK are now installed locally in this project.** Android Studio is optional for command-line compilation and was not installed. The APK uses **min SDK 23 / compile SDK 35 / target SDK 35**; check current Google Play target requirements separately before publishing.

From PowerShell at the project root:

```powershell
.\scripts\android.ps1 -Check
.\scripts\android.ps1
```

The build wrapper runs the web build, Capacitor sync, and Gradle `assembleDebug`, then reports the APK path. It sets Java/SDK/Gradle paths only for the process and restores them afterward. The Android project already exists; do not rerun `android:add`. Sync alone does not compile an APK.

For first-time setup on another Windows x64 machine, run `.\scripts\setup-android.ps1`. It downloads pinned official Temurin 21 and Google command-line-tool archives, verifies SHA-256 checksums, and installs platform-tools, platform 35, and build-tools 35.0.0. Review the SDK license prompt before accepting; the script does not auto-accept licenses. The Android plugin also installs build-tools 34.0.0, its selected default, when needed.

Tools and Gradle caches live in the ignored `.tools` directory; no administrator access or system-wide environment changes are required. The build script can also use an existing `JAVA_HOME`, `ANDROID_HOME`/`ANDROID_SDK_ROOT`, or standard Android Studio installation. See [scripts/setup-android.ps1](scripts/setup-android.ps1) and [scripts/android.ps1](scripts/android.ps1).

The Gradle wrapper is pinned to **9.1.0 with its official distribution checksum**. Gradle 8.11.1 failed with a Windows immutable-cache-directory `AccessDeniedException`; 9.1.0 contains the [upstream Windows locking fix](https://github.com/gradle/gradle/pull/34369) and the APK build passed without antivirus exclusions or cache manipulation. Android Gradle Plugin remains 8.7.2.

To test on a USB-connected Android phone, enable USB debugging and authorize this computer on the phone, then run:

```powershell
.\.tools\android-sdk\platform-tools\adb.exe devices -l
.\.tools\android-sdk\platform-tools\adb.exe install -r .\android\app\build\outputs\apk\debug\app-debug.apk
```

No device was connected during validation, so installation and gameplay on physical Android hardware remain unverified. Test Byte/same-phone play, airplane mode, sounds, haptics, and background/resume before distribution. Online Android play still requires a reachable HTTPS backend in Settings; no public backend is deployed.

Launcher icons at all five densities, adaptive foregrounds, and the launch-screen theme now use BrainRivals branding. `npm run assets` regenerates the icons; native appearance still needs device testing.

App identity and bundled-web configuration are in [capacitor.config.ts](capacitor.config.ts). A successful debug build is not a tested release: production signing, physical-device testing, and AAB publication are pending. Never commit secrets, signing passwords, or keystores.

## Privacy and release status

Offline preferences/name and the latest **50 completed-match summaries** use device `localStorage`; no analytics or advertising SDKs are configured. Online play sends the chosen name and answers to the configured server, which also sees connection metadata/IP information. See [PRIVACY.md](PRIVACY.md) for retention, visibility, and deletion details.

| Gate | Verified status (updated 2026-09-15) |
| --- | --- |
| Automated tests | **47 passed, 0 failed**: prior 39 plus five initial-connection tests and three hosting/origin integration tests. |
| Type-check / production web build | **Passed** via `npm run android:sync`, including icon generation and production service-worker precache. |
| Browser gameplay | **Passed**: complete bot, same-phone, and two-client online matches; explanations, scoring, rematch, host restriction, disconnect handling. |
| Mobile layouts / accessibility | **Partially verified**: screenshots, labels, reduced motion, mute persistence, and all 90 questions checked for visible answer controls at 320×640, 360×800 and 390×844. Physical multitouch, screen-reader audit, and broader device coverage remain. |
| Production offline cache / updates | **Passed browser checks**: reopen without networking, bot and same-phone play, Question Lab; update prompt deferred during play and reload successful after leaving. |
| Android project / sync | **Generated and synced**, with branded launcher assets and launch theme. |
| Java / Android SDK | **Installed locally**, with verified downloads and user-approved SDK license. |
| Native debug compilation | **Passed** using Gradle 9.1.0 / AGP 8.7.2; updated 4,259,238-byte debug APK. Signature, alignment and new bundled JS checked. |
| Physical-device testing | **Pending**: `adb devices -l` returned no devices. |
| Release-signed APK/AAB / Play publishing | **Pending; debug APK only, no tested release claimed**. |
| Render Free configuration | **Prepared** and schema-validated; compiled website/room server tested locally. |
| Production backend / TLS | **Not deployed**: private repository supplied; authenticated Git push and Render sign-in/connection remain pending. |
| Payments / ads | **Not implemented or configured**. |

The dated validation record and outstanding gates are in [RELEASE-CHECKLIST.md](RELEASE-CHECKLIST.md). This is a working development build, not a store-ready or publicly hosted release.