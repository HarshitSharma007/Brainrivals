# BrainRivals project instructions

- [x] Verify that this instructions file is created.
- [x] Clarify requirements: Android-first four-choice quiz battles, same-phone offline duel, computer opponent, private online rooms, three categories, polished visuals and sound.
- [x] Scaffold React/TypeScript/Vite, Capacitor Android, and a Node/Socket.IO server.
- [x] Implement game rules, original question bank, labeled animated UI, and generated audio. Full accessibility/device audit remains a release gate.
- [x] Extensions: no additional extensions required.
- [x] Compile and run automated tests: production web build and 39 tests passed on 2026-09-14.
- [x] Create development task and run its npm dev workflow: frontend 5173 and backend 3001.
- [x] Launch and verify browser gameplay in all three modes, mobile layouts, offline cache, and deferred updates.
- [x] Complete README, privacy notes, and Android/release instructions with dated validation evidence.
- [x] Install checksum-verified project-local Java 21 and Android SDK with user-approved license; add six VS Code setup/build/test tasks.
- [x] Compile debug APK on 2026-09-15; signature, ZIP alignment, package metadata and bundled assets verified. Gradle 9.1.0 fixes the Windows cache-lock failure seen with 8.11.1.
- [x] Prepare Render Free single-service hosting and bounded cold-start connection handling; 47 tests and production build pass. Updated debug APK verified. Local Git `main` points to the user-created private `HarshitSharma007/Brainrivals` repository; initial commit/push is authorized with repository-local GitHub noreply identity. Render email verified per user; authenticated Git push, Render sign-in and public deployment remain pending.
- [ ] Test physical Android devices and produce a release-signed APK/AAB: no device is connected; only a debug APK has been built.
- [ ] Deploy public HTTPS backend, configure signing, and complete Play publication. No monetization SDK is configured.

## Conventions

- Shared pure game rules live in `src/shared/`. Online servers are authoritative; never send answer keys before round results.
- Three category IDs: `general`, `puzzles`, `reasoning`. Selection `mixed` samples all three.
- One answer per player per question. Correct answers score a base plus a bounded speed bonus; wrong/late answers score zero. Free retries between matches, not within a round.
- “IQ challenge” is a theme, not a validated IQ score or proven cognitive-health claim.
- All content, fonts, sound generation, and visual assets must work without external CDNs. No paid services, advertising SDKs, or analytics until explicitly configured.
- Keep controls labeled, support reduced motion and sound mute, and distinguish answers with text/icons as well as color.
- New online connections require room codes and a running backend. Do not present a local demo as an internet deployment.
- Render beta uses one Free instance, compiled `npm start`, `SERVE_WEB=1`, explicit native origins plus `RENDER_EXTERNAL_URL`, and no automatic redeploys. Initial connection retry is not match reconnection. Do not change to paid resources without approval.
- Do not commit secrets or keystores. Document release blockers honestly.
- Windows Android tools and Gradle cache live in ignored `.tools/`. Run `scripts/android.ps1 -Check` or `scripts/android.ps1`; the build script scopes environment variables to the process. Do not downgrade the checksum-pinned Gradle 9.1.0 wrapper without rechecking Windows cache-lock behavior.