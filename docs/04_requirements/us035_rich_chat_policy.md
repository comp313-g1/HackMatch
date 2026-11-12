# US-035 Rich-Chat Scope and Policy Contract

**Issue:** #404, "Approve rich-chat scope, security policy, capacity limits, and feature flags"

**Story / requirement:** [US-035](../02_user_stories/user_stories.md#us-035) / [FR-093](./functional_nonfunctional_requirements.md#fr-093)

**Status:** Approved design contract for Iteration 2, implemented by tasks #405–#411. **Implemented so far:** server-side reaction persistence and API (#405). **Still pending:** React reaction controls (#406), typing indicators (#407–#408), attachments (#409–#410), and the broad test task (#411). Voice/video stays deferred.

**Last reviewed:** November 12, 2026

This contract settles US-035 acceptance criterion 1 ("future design approval is required before shipping"). It also replaces the "virus/size policy TBD" in criterion 3 with concrete rules. Implementation tasks must follow it. A change to any rule needs an update to this document in the same pull request.

The numeric limits are project policy choices for a synthetic-data environment. They are not measured capacity guarantees (see [R-05](./functional_nonfunctional_requirements.md#policy-register)).

## 1. Approved scope

| Feature | Decision | Implementing tasks |
|---|---|---|
| Message reactions | **Approved.** Fixed reaction set; public channels, team channels, and direct messages | #405 API, #406 React |
| Typing indicators | **Approved.** Ephemeral, never persisted, delivered over the existing authenticated SSE pattern | #407 server, #408 React |
| File attachments | **Approved with strict limits.** Allowlisted inert types, private storage, short-lived authorized access, honest scan status | #409 server, #410 React |
| Voice / video | **Deferred.** Not in Iteration 2 (see [section 11](#11-voice-and-video-deferred)) | none |
| Tests for all of the above | Required before any flag is enabled outside local development | #411 |

Everything else stays out of scope: message editing or deletion, threads/replies, link previews, attachment-only messages, reaction notifications, reaction or attachment moderation targets, and new ADMIN chat access.

## 2. Existing architecture this contract builds on

- **Three conversation scopes, three authorization paths** (US-030–US-032). Every chat route uses `requireFirebaseAuth → requireMfa → requireActiveAccount → requireParticipantRole → requireVerifiedParticipant`. Team channel routes add `validateTeamIdParams` and `requireConfirmedTeamMember`. Direct-message routes add `requireDirectThreadParticipant`, and sends also add `requireDirectThreadSendAccess`, which applies block and peer-eligibility checks. A private team channel looks the same as a missing one on public routes (`404 CHANNEL_NOT_FOUND`). Missing and foreign DM threads both return `403 FORBIDDEN_NOT_THREAD_PARTICIPANT`.
- **`ADMIN` has no chat access.** US-033 moderation evidence only projects the targeted `chat_channels` or `chat_messages` row.
- **Messages are append-only.** No edit or delete API exists. `chat_messages` cascade from their channel, and team-channel history is protected by triggers (only the demo reset in migration `0062` removes it). `direct_messages` threads are `ON DELETE RESTRICT`. Message metadata tables (`chat_message_mentions` and `direct_message_mentions`, migration `0060`) use one table per scope with `ON DELETE CASCADE` from the message. Bodies are 1–4,000 characters.
- **Responses** use allowlist projections plus a secret scrub (`chatPrivacy` and `directMessagePrivacy`), `Cache-Control: no-store`, and safe error codes.
- **Realtime** is a server-authenticated SSE stream (`/api/notifications/stream`) with a 25 s heartbeat, 15 min maximum lifetime, 5 streams per participant, and a 3 s retry. Streams are routed per participant by an in-process hub. The browser has no Supabase client, and chat messages themselves are not delivered in realtime.
- **Configuration** is server environment variables read in `server/src/config/index.ts`. Booleans are parsed as an exact `'true'`. The repository has no feature-flag mechanism and no file storage, upload parsing, or malware-scanning facility. Express uses the default `express.json()` body limit (about 100 KB).
- **Rate limiting** has two patterns: the in-memory sliding window in `utils/rateLimiter.ts`, and the database-backed rolling window in `services/reportRateLimiter.ts` (`429 RATE_LIMITED`, `Retry-After`).

## 3. Privacy and authorization (applies to every feature)

1. **Inherit, never widen.** Each rich-chat operation uses exactly the guard chain of the conversation it belongs to. Reading reactions or attachment metadata needs read access. Adding or removing a reaction, sending a typing signal, or uploading or attaching a file needs **send** access. That means confirmed team membership for team channels, and for DMs the send-access guard, so a blocked or ineligible pair cannot react, signal typing, or upload. Downloading needs read access, **re-checked at download time**.
2. **Same denial shapes.** Rich-chat routes on a hidden team channel or a foreign DM thread return the same status and code as the existing message routes, so they cannot be used to probe existence.
3. **No ADMIN access.** No ADMIN route lists, reads, downloads, or aggregates reactions, typing activity, or attachments. US-033 moderation evidence for a targeted `chat_message` may include that message's attachment **metadata** (sanitized display name, detected type, size, scan status). It never includes file bytes, storage keys, or download URLs. ADMIN file access would need its own approved story.
4. **No new identity exposure.** Reactors and typists are identified only by the handle already visible in that conversation. Responses never include email, full name, Firebase UID, role, verification/suspension state, presence, block state, storage keys, or signed URLs (except the single URL a download response exists to return).
5. **Invisible presence.** A participant whose presence is `Invisible` emits no typing indicators; the server drops their signals. Reactions remain visible, because they are persisted conversation content like messages.
6. **Logging (NR-021).** Logs may record ids, counts, sizes, detected types, outcomes, and error codes. They never record file bytes, original or display filenames, signed URLs, storage tokens, reaction or typing payload bodies, message text, or draft text. Extend the existing `requestLogger` redaction rather than adding ad-hoc logging.
7. **Rendering (NR-009).** Reaction glyphs come from a fixed client table keyed by code, never from stored text. Filenames render as text nodes. Only raster images (section 6) may render inline, as `<img>` with the sanitized display name as alt text.

## 4. Message reactions

| Rule | Decision |
|---|---|
| Reaction set | Fixed codes: `thumbs_up`, `heart`, `laugh`, `party`, `surprised`, `sad`, `eyes`, `check`. Arbitrary Unicode or custom emoji are rejected (`400 VALIDATION_ERROR`). A database `CHECK` constraint enforces the set. |
| Cardinality | One row per (message, participant, code). A participant may use several different codes on one message, at most 8 because the set is fixed. |
| Operations | Add and remove are idempotent. Adding an existing reaction or removing a missing one succeeds without duplicating or failing. The response returns the message's current aggregate. |
| Response shape | Per code: `count` and `reactedByMe`. Reactor handle lists are not returned in Iteration 2. |
| Storage | `chat_message_reactions` and `direct_message_reactions`, mirroring the `0060` mention tables: message FK `ON DELETE CASCADE`, participant FK `ON DELETE CASCADE`, composite primary key, RLS enabled with no browser policies, service-role-only access. |
| Side effects | Reactions do not create `participant_notifications`, do not change US-034 unread or mention counts, and do not update `last_message_at`. |
| Moderation | Reactions are not US-033 targets; they disappear with their message. |
| Rate limit | 30 reaction mutation requests (add or remove) per authenticated participant per rolling minute, then `429 RATE_LIMITED` with `Retry-After`. Idempotent duplicate adds and removes count toward the limit. Requests rejected before the limiter (invalid input, feature disabled, or unauthenticated) do not use the budget. |

## 5. Typing indicators

| Rule | Decision |
|---|---|
| Persistence | **None.** Typing state lives only in server memory and is never written to PostgreSQL, logs, or notification rows. |
| Payload | Conversation scope and id, the typist's handle, and `typing: true/false`. Never the draft text, its length, or keystrokes. |
| Client throttle | At most one "typing" signal per conversation every **2 s** while the participant is typing. Send `typing: false` on message send, cleared composer, blur, conversation change, or unmount. |
| Expiry | The server expires an indicator **6 s** after the last signal. The client independently hides it 6 s after the last event, so a lost "stop" signal never sticks. |
| Delivery | Only to participants who currently pass the conversation's read guard and are viewing that conversation. Authorization is checked when the subscription is registered, and access loss ends delivery. Typists never receive their own indicator. |
| Transport | Reuse the server-authenticated SSE pattern of `notificationStream` (fetch-based, `Authorization` header, existing heartbeat, lifetime, and per-participant stream cap). No browser Supabase client, no new WebSocket server, and no new realtime vendor. Typing delivery is in-process. In a multi-instance deployment indicators reach only participants on the same instance; that is acceptable degradation for an advisory feature. |
| Display | Up to 3 handles, then "Several people are typing". Announced politely to assistive technology (NR-018). |
| Rate limit | Server accepts at most 40 typing signals per participant per rolling minute and drops the excess with `429 RATE_LIMITED`. The client ignores typing errors. |

## 6. File attachments

### Allowed content

| Detected type | Extensions accepted for display | Inline preview |
|---|---|---|
| `image/png` | `.png` | yes |
| `image/jpeg` | `.jpg`, `.jpeg` | yes |
| `image/gif` | `.gif` | yes |
| `image/webp` | `.webp` | yes |
| `application/pdf` | `.pdf` | no (download only) |
| `text/plain` (UTF-8) | `.txt` | no (download only) |

Everything else is rejected with `415 ATTACHMENT_TYPE_NOT_ALLOWED`, including SVG, HTML, XML, JavaScript and other scripts, executables, installers, archives (`.zip`, `.rar`, `.7z`, `.tar`, `.gz`), Office and macro-capable documents, CSV (spreadsheet formula injection), audio, and video.

The type is decided by the **server inspecting the file's leading bytes** (magic-number signature). For `text/plain`, the server also requires valid UTF-8 with no NUL bytes. The browser-declared `Content-Type` and the filename extension are never trusted; a mismatch between the detected type and the extension is rejected.

### Limits

| Limit | Value |
|---|---|
| Size per file | 10 MB (10,485,760 bytes), enforced while streaming, not after buffering |
| Attachments per message | 5 |
| Uploads per participant | 20 per rolling hour (database-backed, `reportRateLimiter` pattern) |
| Stored attachments per participant | 100 MB total (pending plus attached) |
| Pending (not yet attached) uploads | Deleted 24 h after upload |
| Display filename | Server-sanitized: path components, control characters, and bidirectional-override characters stripped; at most 255 characters; never used as a storage path |

The message body rules do not change. A message with attachments still needs a 1–4,000 character body; attachment-only messages are deferred.

### Upload, storage, and access

1. **Upload path.** Files go through the authenticated Express API as a dedicated streamed multipart request, one file per request, with a hard byte cap. They never travel as JSON or base64, and the global `express.json()` limit is not raised. The upload is bound to the caller and to one conversation, and the send-access guard runs before any byte is stored.
2. **Attach.** A message send may reference up to 5 of the caller's own pending uploads for the **same** conversation. Uploads that belong to someone else, belong to another conversation, are already attached, or have expired are rejected. Message insert and attachment linking happen in one transaction.
3. **Storage.** A **private** Supabase Storage bucket is accessed only with the server's service role. Object keys are opaque, server-generated UUID paths that contain no filename, participant id, or conversation name. There is no public bucket and no browser Supabase client.
4. **Metadata.** `chat_message_attachments` and `direct_message_attachments` mirror the mention-table pattern (message FK `ON DELETE CASCADE`, RLS on, service-role only). Each row holds the uploader, the conversation bound at upload, the opaque storage key, the sanitized display name, the detected type, the byte size, the scan status, and timestamps.
5. **Download.** An authorized download request re-checks read access and the scan rule below. It then returns a signed URL that **expires after 60 seconds**. URLs are never stored, cached (`no-store`), or logged. Objects are stored with their detected type. PDF and text are always delivered as downloads (`Content-Disposition: attachment`), never rendered inline. If the storage provider's signed URL cannot guarantee that header and `X-Content-Type-Options: nosniff`, the server streams the file itself with those headers instead.
6. **Transport and at-rest protection** follow NR-006 (HTTPS only; provider-managed storage encryption).

### Malware scanning decision

The project has **no malware-scanning facility today**, and this contract does not pretend otherwise.

- Every attachment carries `scan_status`: `not_scanned`, `pending`, `clean`, `infected`, or `scan_failed`.
- With no scanner configured, uploads are stored as `not_scanned`. The UI must label them **"Not scanned for malware"**, and no response, UI text, log, or document may describe them as scanned or safe.
- The type allowlist, signature checks, inline-preview limits, and forced download headers reduce risk; they are not scanning.
- `RICH_CHAT_ATTACHMENTS_ENABLED` may be `true` only in local, test, or synthetic-data demo environments while no scanner exists. Enabling attachments where real participants' files are stored requires an approved scanner integration first. In that mode an upload starts `pending`, downloads are served only for `clean`, and `infected` files are deleted from storage. `scan_failed` and `pending` files are never downloadable.

## 7. Retention and deletion

- Rich-chat data follows its message's lifecycle. Reactions and attachment metadata cascade with the message. Team-channel history protection still applies, and nothing in US-035 adds a message delete API.
- Database cascades do not remove storage objects. Any path that deletes attachment rows (channel deletion, the `0062` demo reset, account deletion processing under FR-078, pending-upload expiry) must also delete the matching objects. An object whose row is gone must never stay downloadable.
- Turning a feature flag off hides and blocks the feature but **does not delete data**.
- Typing state is never stored, so it needs no retention rule.
- No separate legal or backup retention period is set here. That decision belongs to [R-06](./functional_nonfunctional_requirements.md#policy-register) and [NR-023](./functional_nonfunctional_requirements.md#nr-023), and until it is approved, environments use synthetic data.

## 8. Feature flags (server-authoritative)

| Server environment variable | Default | Meaning |
|---|---|---|
| `RICH_CHAT_REACTIONS_ENABLED` | `false` | Reaction reads and changes |
| `RICH_CHAT_TYPING_ENABLED` | `false` | Typing signals and delivery |
| `RICH_CHAT_ATTACHMENTS_ENABLED` | `false` | Uploads, attachment metadata, and downloads (subject to the scanning rule above) |

- Flags are read once at startup through `server/src/config/index.ts`, alongside the existing settings. Only the exact string `true` enables a flag; anything else, including a missing value, means off. The implementing task adds each variable to `config` and `server/.env.example` when its feature code lands; #404 adds no configuration.
- **Voice/video has no flag.** It has no code to turn on, so its absence is the control (section 11). The capability response always reports `voiceVideo: false`.
- **The browser is never the authority.** There are no `VITE_` rich-chat flags (Vite variables are public and fixed at build time). The client reads an authenticated, PART-guarded capability response, for example `GET /api/chat/capabilities` returning each flag and the public attachment limits, and hides controls accordingly.
- **Every rich-chat route checks its flag on the server.** When a flag is off, the route returns `404 FEATURE_DISABLED` and changes nothing, and message responses omit that feature's fields.

## 9. Graceful degradation

Text chat (US-030–US-034) must keep working whatever happens to rich-chat features:

- Existing text-message routes and views take no runtime dependency on rich-chat code, storage, scanning, or typing delivery.
- If the capability request fails, the client treats every rich-chat feature as off.
- If reactions fail to load, messages still render without them. If a reaction change fails, the UI shows the last server-confirmed state.
- If typing delivery is unavailable, no indicator is shown. Reconnection follows the existing retry and backoff behavior, so there are no retry storms and no user-facing error.
- If storage is unavailable, upload or download fails with `503 ATTACHMENT_STORAGE_UNAVAILABLE`, the composer keeps its text draft, and plain text sends still work.
- If the scanner is unavailable (when one is configured), files stay `pending` or `scan_failed` and are not downloadable.

## 10. Abuse and capacity summary

| Control | Value | Pattern |
|---|---|---|
| Reaction mutation requests | 30 / authenticated participant / minute, idempotent duplicates included | In-memory sliding window (`utils/rateLimiter.ts` style) |
| Typing signals | 40 / participant / minute; client ≥ 2 s apart; 6 s expiry | In-memory |
| Uploads | 20 / participant / rolling hour | Database rolling window (`reportRateLimiter` style) |
| Attachment size, count, and quota | 10 MB, 5 per message, 100 MB per participant | Server validation and database totals |
| Signed download URL | 60 s lifetime, issued per authorized request | Storage provider signing |
| SSE streams | Existing 5-per-participant cap, unchanged | `notificationStream` |

In-memory limits reset on restart and are per instance. Persisted features (uploads) use database-backed limits. Every rejection returns `429 RATE_LIMITED` with `Retry-After` and no extra data.

## 11. Voice and video (deferred)

Voice and video are not part of Iteration 2. Nothing below may be added under US-035 without a new story that has its own security, privacy, and capacity review: WebRTC, signaling endpoints, TURN/STUN servers, media servers or SFUs, call or recording storage, voice messages, video calls, and screen sharing. Audio and video files are also excluded from the attachment allowlist.

## 12. Acceptance checks for #411

The test task must show at least the following:

- Each flag set to off returns `404 FEATURE_DISABLED` with no side effects, and text chat is unaffected.
- The capability response matches the server flags and always reports `voiceVideo: false`.
- Denial shapes match the existing routes for visitors, unverified or suspended accounts, `ADMIN`, non-members of team channels, foreign DM threads, and blocked DM pairs.
- Reactions: the fixed code set is enforced, add and remove are idempotent, aggregates are correct, the rate limit applies, the data cascades with its message, and no unread, mention, or notification side effects occur.
- Typing: indicators expire, are delivered only to authorized viewers, are never received by the typist, are dropped for `Invisible` participants, are never persisted, and never include draft text.
- Attachments: signature-based type detection (spoofed extension and spoofed `Content-Type` both rejected), the size, count, hourly, and quota limits, cross-conversation and cross-owner attach attempts rejected, download access re-checked, 60 s URL expiry, scan-status gating, honest `not_scanned` labelling, and storage cleanup when rows are deleted.
- Responses and logs contain no filenames, signed URLs, storage keys, secrets, or private identity fields.
- Unavailable storage or realtime leaves text chat working and keeps drafts.
