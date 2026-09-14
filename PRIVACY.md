# BrainRivals — Privacy notes

**Last updated: 2026-09-14 · Current development build**

This describes the current app, not a deployed production service. No cloud backend is deployed. Before a public release, the operator must add a real privacy contact, hosting-provider details, applicable retention practices, and a publicly accessible policy URL.

## Offline play and device storage

Same-phone duels, Byte matches, and Question Lab run locally. Offline play does not send player names or match history to a game server. The current persistence implementation uses **`localStorage`**, including inside the native WebView—not a cloud account or the Capacitor Preferences API.

| Data | Purpose and retention |
| --- | --- |
| `brainrivals:settings` | Preferred player name, sound, haptics, reduced-motion preference, and configured online server URL. Kept locally until changed or the app/site data is cleared. |
| `brainrivals:history` | At most the **latest 50 completed-match summaries**, newest first: match ID, date, mode, score, correct count, rounds, win/draw flags, and average correct-answer response time. Older entries are dropped. |
| Active match state | Names, questions, answers, and round results used in memory for play/review. The same-phone rival's name is not saved as a preference. Detailed answer history is not written to the persisted match-summary list. |
| Production web cache | App code, assets, and the bundled question bank for offline use after the initial visit and successful service-worker caching. This is separate from preferences/history. |

Completed online matches also create local summaries; their match ID can contain the room code and match-start timestamp. Persisted summaries do not contain player names or individual answers. Abandoned matches are not saved as completed matches. “Your progress” reflects the retained summaries, not an unlimited lifetime record.

Storage is local, not encrypted by the app and not guaranteed permanent: browser settings, device access, platform backups, storage eviction, and clearing app data may affect it. The app can still play if saving local storage fails, but preferences/history may not persist. Use a nickname rather than sensitive information.

## What online play sends

Connecting to a private room sends data to the **server selected in Settings or configured into the build** (otherwise the browser's own origin). Choose a server you trust. A room is limited to two players, but its invitation code is not identity verification.

- **Chosen name, room code, and match settings** for creating/joining a room.
- **Current question ID and answer choice** when submitting an answer. The server measures elapsed time on receipt; the client does not supply authoritative timing or scores.
- **Socket identifiers and network metadata.** Socket.IO and the hosting infrastructure can observe connections and IP addresses; the app does not need to put an IP address inside the answer payload. IP addresses are not part of the game room's stored match-history fields.
- **Shared game state:** the other player receives your displayed name, socket-based player ID, score, and whether you have answered. Answer choices, correctness, points, and measured response times are shared at reveal and in that room's revealed history. The normal room protocol does not send the other player your IP address.

There is no account registration, cloud profile, chat, analytics SDK, advertising SDK, or payment integration in the current app. Byte is a local probabilistic bot, not a hosted AI provider. Sounds are generated locally; optional haptics use the device.

The complete question bank and explanations are intentionally available offline and in Question Lab. Hiding answer keys from online question messages until reveal **does not make the bank confidential or provide anti-cheat security**.

## Server retention and hosting

The supplied backend holds rooms, player names/socket IDs, submissions, scores, and revealed results in **transient process memory**. It has no game database or persistent match store.

- Leaving or disconnecting disposes of the room and invalidates its code for both players. There is no reconnect/resume period.
- Inactive lobbies and finished rooms expire after **15 minutes** by default; this is not a blanket retention timer for an actively progressing match.
- A rematch resets the room's scores and revealed history. Restarting or shutting down the backend removes its rooms.
- These limits concern the supplied server's live room state. They do not delete summaries already saved on a device or copies/screenshots made by another player.

The game code does not implement persistent gameplay or IP logging. A future hosting provider, reverse proxy, or operator may independently retain access/security logs, including IP addresses and request metadata. Those practices and retention periods are **not configured or verified here** and must be disclosed before hosting a public service. Browser delivery also reveals ordinary connection metadata to the web host on initial loads and update checks, even when the game mode itself is offline.

Production must use **HTTPS and secure WebSockets**. Native Android requires an HTTPS server URL; local browser development can use HTTP. Transport encryption is not end-to-end encryption: the configured game server processes the data. Origin allowlists and basic rate limits are not user authentication, comprehensive abuse prevention, or a security certification.

## Your controls

- Use **Settings** to change the preferred name, server address, sound, haptics, or reduced motion.
- Use **Your progress → Clear local history** to delete saved match summaries. This does not clear preferences or the offline web cache, and it does not erase another player's copies.
- Clear the site's storage/cache in the browser, or clear the app's storage in Android settings, to remove local preferences/history and applicable cached data. Web offline use then needs another successful cache-filling visit; native assets remain part of the installed app.
- Leave the online match to dispose of its live server room. Infrastructure logs, if introduced by an operator, are governed by that operator's disclosed policy, not this button.

There is no in-app account-deletion process because no accounts are implemented. Any future support/deletion requests concerning hosting logs need a published operator contact; none is specified yet.

## Children, claims, and future changes

“IQ challenge” is a playful theme. Scores are game points, **not validated IQ scores**, and the app makes no substantiated claim to sharpen IQ or improve cognitive health.

The intended age audience and any child-directed status must be decided before publication. No claim of child-privacy or store-policy compliance has been validated. Review applicable consent, parental, data-minimization, content-rating, and Google Play Families requirements before offering the app to children.

Ads, analytics, payments, accounts, persistent storage, or new hosting/logging arrangements would change these disclosures. Review data flows, required consent, SDK practices, and Play Data safety declarations **before** adding them. Do not advertise the online app as collecting “no data.”

Implementation references: [src/lib/storage.ts](src/lib/storage.ts), [src/lib/online.ts](src/lib/online.ts), [src/App.tsx](src/App.tsx), and [server/index.ts](server/index.ts). Publication gates: [RELEASE-CHECKLIST.md](RELEASE-CHECKLIST.md).