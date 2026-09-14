# BrainRivals — Release checklist

**Status: Android debug APK built and checked / device and release validation pending · 2026-09-15**

Checked items have evidence below. Unchecked items include both untested release requirements and gates with only partial coverage; working browser code is not proof of a tested Android release.

| Gate | Current status |
| --- | --- |
| Automated tests | 47 passed; 0 failed |
| Type-check and production web build | Passed; final production assets synced into Android |
| Browser / accessibility / production offline tests | All three modes and offline/update flows passed; accessibility/device audit remains partial |
| Android project generation | Generated, branded, and synced |
| Native debug build | Passed using project-local Java/SDK and Gradle 9.1.0 |
| Physical Android testing | Pending: no device connected |
| Release-signed APK / signed AAB | Pending; only the debug-signed APK is verified |
| Public backend / production TLS | Render Free package prepared; private GitHub repository supplied, authenticated push/account connection pending, not deployed |
| Play testing, production access, review, publishing | Pending |
| Payments / ads / monetization | Not implemented or configured |

For each completed gate, record the date, commit/build identity, command or test procedure, result, and evidence location. For failures, record the blocker; do not convert “attempted” into “passed.”

## Render preparation record — 2026-09-15

- Publishing handoff update: the user supplied private repository `https://github.com/HarshitSharma007/Brainrivals.git` and reports Render email verification complete. `origin` is configured locally. Author identity uses public GitHub account ID 79695575 and login HarshitSharma007 to form the GitHub private noreply address. A noninteractive remote-branch check could not authenticate, and the shared Render browser tab redirected to sign-in. The authorized local commit can be created, but successful remote push and service deployment must still be verified; do not force-push over any existing repository history.
- Added [render.yaml](render.yaml): exactly one Node Web Service, explicit `free` plan, one instance, automatic deploys off, `/health` check, Node 22, `SERVE_WEB=1`, room cap 100, and native app origins. No database, disk, paid resource, keep-awake service or Supabase migration was added. Local AJV draft-2020 validation against Render's official schema passed; its unused maintenance-URI format emitted a validator warning. Render-account validation remains pending.
- `npm test`: **47 passed, 0 failed**. New coverage: cold-start retry, hard 90-second deadline, cancellation/cleanup, no reconnect after success, built-files-only hosting, Render/native origins, and missing web builds. Existing scoring/room-authority tests still pass.
- `npm run build:render`: passed strict TypeScript, Vite/PWA, and esbuild backend compilation. `npm start` ran the compiled server locally on 3012 with Render-style process variables, serving the website and Socket.IO from one origin. It does not require `tsx` at runtime.
- Browser smoke against that compiled service: unreachable-server notice and cancel button, recovery to a normal create/join, identical question/scoreboard between two clients after reveal, and `/health` returning `{"ok":true}`. This is not a public Render deployment test or a measured real cold start.
- Rebuilt debug APK through `scripts/android.ps1`: **BUILD SUCCESSFUL**, 24 executed/115 up-to-date native tasks. The current [APK](android/app/build/outputs/apk/debug/app-debug.apk) is **4,259,238 bytes**, SHA-256 `AA63E50D226CEB7C4004B455B92314A5EA6A6BF1210577DF0C84596DC12ED059`. APK v1/v2 signature verification and ZIP alignment passed.
- Current JS entry: `dist/assets/index-DznlKMj8.js`, SHA-256 `57DF834B3FAC544C49E1C3BA73DC5890180249026D7DE8598E8BC109B0512ACD`. The APK entry matches exactly. This supersedes the earlier artifact identity below; historical browser/device caveats remain.
- Render dashboard progressed to **email verification**, which is still pending. After explicit user authorization, a local Git repository was initialized on `main` and 93 files staged. Prohibited-path and common-secret-pattern checks returned no matches; these are not a comprehensive security audit. A private GitHub repository, initial commit/push, and GitHub-provided noreply author identity are authorized but blocked on sign-in. No commit, remote, upload, Render service or public URL exists yet. [RENDER.md](RENDER.md) records the handoff and required live checks. Physical-device and live HTTPS validation remain open.

## Initial native build record — 2026-09-15

- Added six workspace tasks for local play, web build, automated tests, Android tool installation/checking, and debug APK compilation. Scripts: [scripts/setup-android.ps1](scripts/setup-android.ps1), [scripts/android.ps1](scripts/android.ps1). PowerShell parsing and task JSON validation passed.
- Installed official Temurin **21.0.12.1+1** and Google command-line tools **15859902** in ignored `.tools` paths; both archive SHA-256 checks passed. The user explicitly accepted Google's Android SDK license before the SDK manager prompt was answered. No system-wide environment, security exclusions, or administrator installation was used.
- SDK packages: Android platform **35**, build-tools **35.0.0**, and platform-tools. AGP automatically installed its selected default build-tools **34.0.0** under the already accepted SDK license. Android Studio/emulator were not installed.
- Gradle 8.11.1 failed before compilation with `AccessDeniedException` renaming immutable transform cache directories; a single-worker/no-watch retry reproduced it. Updated the wrapper to **Gradle 9.1.0**, whose [upstream fix](https://github.com/gradle/gradle/pull/34369) changes Windows workspace locking, and pinned official distribution SHA-256 `a17ddd85a26b6a7f5ddb71ff8b05fc5104c0202c6e64782429790c933686c806`. AGP remains **8.7.2**. No failed-cache files were manually promoted or security software disabled.
- `.\scripts\android.ps1`: **BUILD SUCCESSFUL**, 139 native tasks executed; web build and Capacitor sync also passed. The bundled JavaScript is unchanged from the verified web build below.
- Original APK before the Render preparation rebuild: **4,236,661 bytes**, SHA-256 `BECFC2C311562F5FCA8D5F8370CF7D79276BB0CBF065D4556DD34C4DB1BCC4AF`. The build output path has since been replaced by the newer artifact above.
- `apksigner verify --verbose --print-certs`: **verifies**, v1 and v2 signatures valid, one **Android Debug** signer. Release-signing/Play-signing is not configured. The verifier emitted legacy JAR-signature warnings for META-INF metadata entries; the v2 whole-APK signature passes. Do not modify signed package entries manually.
- `zipalign -c -P 16 4`: **passed**. `aapt dump badging` confirms `com.brainrivals.game`, versionCode **1**, versionName **1.0**, min SDK **23**, target/compile SDK **35**, label **BrainRivals**, and launch activity `com.brainrivals.game.MainActivity`. Declared uses-permissions: INTERNET, VIBRATE, and the app-specific dynamic-receiver non-exported permission.
- ZIP inspection found the Android manifest, DEX, Capacitor config, HTML, and PNG icons. Packaged `assets/public/assets/index-odfgSZ7J.js` matches production SHA-256 `02F61116006C301BFDA7380531C59115E028EBBF308CFAA40EEB9F1D7AB05946` exactly.
- Non-blocking build warnings remain: Capacitor flatDir repositories, newer SDK XML metadata, unchecked library operations, and APIs deprecated for Gradle 10. No lint, release-variant, emulator, device or Play compliance pass is implied by debug compilation.
- `adb devices -l`: **no connected devices**. USB installation, real multitouch, native audio/haptics, native offline behavior, lifecycle and release-mode testing remain pending. Public backend, monetization, release signing and publication were not changed.

## Validation record — 2026-09-14

- Environment: Windows, Node.js 22.21.1; commands executed at `E:\GAme`. No commit or branch was created.
- `npm test`: **39 passed, 0 failed**, including [tests/local.test.ts](tests/local.test.ts), [tests/rules.test.ts](tests/rules.test.ts), and [tests/online.test.ts](tests/online.test.ts). Node reports its MockTimers API as experimental; the tests pass.
- `npm run android:sync`: **passed**. Runs icon generation, strict TypeScript compilation, Vite build, PWA precaching, and Capacitor Android sync. 18 branded PNG icons were generated and their dimensions checked. 14 resources are precached.
- Final web entry: `dist/assets/index-odfgSZ7J.js`; SHA-256 `02F61116006C301BFDA7380531C59115E028EBBF308CFAA40EEB9F1D7AB05946`. CSS: `dist/assets/index-Bk24lN3C.css`. Bundle and manifest are in `dist/`; synced assets are in `android/app/src/main/assets/public/`.
- Development frontend/backend started successfully at localhost ports **5173/3001**; production preview on **4173**. These are local services, not cloud deployment.
- Browser same-phone test: completed five rounds, rejected answer changes, correct-only score increase, one saved history record, and rematch scores reset to zero. Mirrored controls were screenshot-checked at 390×844.
- Browser bot test: completed five rounds with a controlled random source, delayed bot answers, correct/incorrect feedback, final totals, and five answer-review entries. Test control does not change production randomness.
- Real-time two-browser online test: create/join, five synchronized questions and scoreboards, no explanation after only one submitted answer, both result screens, host-only rematch, then guest disconnect causing abandoned-room UI. Automated integration tests separately cover full/invalid/expired rooms and protocol validation.
- Production offline test: completed initial service-worker cache, disabled networking, closed/reopened the page, then exercised bot play/reveal, Question Lab explanations, and a same-phone round/reveal. Mute setting persisted. Final same-phone test at 320×640 showed all eight buttons within the viewport and keyboard-focusable prompts.
- Layout stress check: substituted each of the 90 actual question/option sets into the rendered two-player view at 320×640, 360×800, and 390×844. Long-question overflow on short phones was fixed with independently scrollable prompts. The final 320×640 pass reported zero clipped/off-screen answer controls, each at least 44px high, and no horizontal overflow.
- Web-update test: in an isolated browser profile, intercepted only the service-worker response to simulate two versions of the same production worker. A waiting worker did not show the update action during play; leaving showed it, and **Update & reload** completed successfully. Production files were not changed by this test.
- Native attempt: `android\gradlew.bat -p android assembleDebug` stopped before compilation with **JAVA_HOME is not set and no 'java' command could be found in your PATH**. Java/Android SDK were not found in configured or standard locations. No APK/AAB, emulator, or physical-device result is claimed.
- Browser checks used temporary profiles or synthetic test data; they are functional checks, not full accessibility, security, performance, or app-store compliance audits. Integration-browser zoom was accounted for using measured CSS viewport sizes.

## 1. Code and automated validation

- [ ] Install dependencies with `npm install`; review dependency/security and license findings for the release snapshot.
- [x] Run `npm test`; 47 tests passed across shared rules, local matches, connection startup, static hosting, and Socket.IO integration.
- [x] Run `npm run build`; successful strict type-check and production build recorded above, separately from native compilation and device validation.
- [ ] Review all 90 questions for accuracy, ambiguity, originality, and suitability for the chosen audience; confirm 30 per category and balanced mixed matches.
- [ ] Verify one-answer lock, 5/10/15 rounds, 3-second countdown, 15-second deadline, 4-second reveal, exact scoring, draws, timeout handling, and rematches. Confirm bot settings affect accuracy/delays, not the question pool.
- [x] Inspect online payloads before reveal for premature keys/explanations; tests pass. The shared downloadable bank is still **not anti-cheat or esports-secure**.

## 2. Browser and offline experience

- [x] Start with `npm run dev`; web on 5173 and backend/proxy on 3001. Complete bot, same-phone and two-browser online matches exercised through the UI.
- [x] Test two clients: UI verified create/join, host-only rematch, full match and disconnect. Live integration tests verified wrong/full/expired codes, host guards, duplicates, deadlines, and room disposal. No reconnect/resume is promised.
- [ ] Use `npm run preview` after a production build; allow the actual preview origin and run the backend separately for online checks.
- [ ] On a production build, complete an initial online visit and service-worker asset caching, then close/reopen offline and play Byte, same-phone, and Question Lab. Test cache clearing and updates. Do not substitute a development-mode check for this gate.
- [ ] Check narrow phones/tablets, mirrored tabletop and side-by-side controls, simultaneous touches, text wrapping, large text, keyboard/focus, screen readers, labels, contrast, reduced motion, and mute.
- [ ] Check history persistence, the 50-summary cap, history deletion, preference changes, and graceful behavior when local storage is unavailable.

## 3. Android build, signing, and device testing

- [x] Install and validate Android SDK and **Java 21** for command-line compilation. Android Studio is optional and was not installed.
- [x] Android project exists; `npm run android:sync` passed with branded icons and launch theme. Do not rerun `android:add`.
- [x] Compile a debug APK and verify its signature, alignment, package metadata and bundled game content. Evidence recorded above; physical-device testing is a separate gate.
- [ ] Inspect the generated project: Capacitor 7 defaults are **min SDK 23, compile SDK 35, target SDK 35**. Verify the current Play target API requirement at submission and adjust the SDK/dependencies as needed; defaults are not a publishing-compliance guarantee.
- [ ] Confirm app ID, version code/name, adaptive icons, launch appearance, permissions, and native plugin configuration. Inspect the final manifest rather than assuming it requests only intended permissions.
- [ ] Build and install on **physical Android devices**, including representative supported OS versions and a lower-powered phone. Record devices/OS/builds and results, not just emulator or sync output.
- [ ] Test bundled assets in airplane mode after installation: Byte, same-phone play, Question Lab, audio/mute, haptics, history, cold launch, back navigation, safe areas, rotation, background/foreground, and process death.
- [ ] Test online play between devices against a real HTTPS backend, including latency, Wi-Fi/mobile transitions, loss of connection, and the expected abandoned-room behavior. `https://localhost` must be allowed as the Android origin; the phone must use a reachable backend, not the developer PC's localhost URL.
- [ ] Produce and verify a **signed APK** for appropriate device/distribution testing and a **signed AAB** for Play. Validate release-mode installs and the update path; debug builds do not clear this gate.
- [ ] Configure signing/Play App Signing and secure backup/recovery outside the repository. **Never commit keystores, signing passwords, tokens, or other secrets**; verify ignore rules and the final release inputs.

## 4. Production backend and operations

- [x] Prepare the free-only Render blueprint, compiled start/build commands, same-origin website hosting, initial-connection retry/cancel UI, tests, and [RENDER.md](RENDER.md). Local validation is complete, but public provisioning is not.
- [ ] Provision actual hosting for the separately running Node/Socket.IO backend. There is **no cloud deployment** established by this repository or a frontend/native build.
- [ ] Configure HTTPS/TLS and secure WebSocket forwarding, Socket.IO polling, health checks at `/health`, network exposure, and graceful shutdown. Test from outside the development network.
- [ ] Set the public backend through build-time `VITE_SERVER_URL` or runtime Settings. Rebuild/resync for a changed build-time value; keep all `VITE_` values non-secret.
- [ ] Supply `PORT`, `ALLOWED_ORIGINS`, and `MAX_ROOMS` through the backend **process environment**. The server does not automatically load dotenv files; [.env.example](.env.example) alone does not configure it. Ensure `tsx` is present if using `npm run server`.
- [ ] Set explicit allowed origins: real web origins, `https://localhost` for Capacitor Android, and local development/preview origins only where needed. No wildcard origins or paths. Validate both browser and native connections; origin checks are not authentication and missing Origin is accepted.
- [ ] Document acceptable capacity and restart behavior for the **single-process, in-memory** server. Restarts lose rooms; there is no durable persistence, failover, or reconnection. Multi-instance state/routing and deployment scaling remain future work—not a capability unlocked by adding replicas.
- [ ] Load-test the intended launch size and add appropriate infrastructure abuse/DDoS protections. Current per-socket limits, message caps, and room limits are not DDoS protection.
- [ ] Define deployment/rollback procedures, uptime ownership, TLS renewal, minimal operational logging, retention, and incident response. Disclose any new data processing before enabling it.

## 5. Privacy, Play publication, and monetization

- [ ] Finalize [PRIVACY.md](PRIVACY.md) with the actual operator/contact, hosting/logging practices, retention, and public policy URL; verify all claims against the signed app and deployed backend.
- [ ] Complete accurate Play Data safety, content rating, target audience, ads declaration, and store assets. Do not claim online play collects no data or that game points are validated IQ scores; do not claim the app sharpens IQ or improves cognitive health.
- [ ] Decide whether the app is child-directed or includes children in its audience; review applicable child-privacy/consent rules, Families requirements, content, and any SDK restrictions. Compliance is not yet established.
- [ ] Verify current [Google Play testing requirements](https://support.google.com/googleplay/android-developer/answer/14151465) for the account. New personal accounts subject to the rule need **at least 12 testers continuously opted in for at least 14 days**, then an application for production access and **approval**. This is not instant publishing or a guarantee of approval.
- [ ] Complete account/device verification, applicable closed testing, production-access approval, app review, and controlled publishing. Record actual Play Console results; uploading an AAB is not publication.
- [ ] Make an explicit monetization decision. Payments, purchases, and ads are **not implemented**; either approve a no-monetization release or implement and validate them separately before making paid/ad-supported claims.
- [ ] If monetizing, verify current billing, ads, consent, age/child-directed, tax, merchant/payout, and store policies; test purchase/restore/refund or ad flows as applicable and update privacy/Data safety disclosures. Revenue or approval is not guaranteed.
- [ ] Final release sign-off: attach dated test/build/device/hosting/publishing evidence and update [README.md](README.md). Leave every unmet or unverified gate open, with a blocker or an explicit justified not-applicable decision.