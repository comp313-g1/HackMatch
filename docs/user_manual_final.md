# HackMatch User Manual (Final)

| Item             | Detail                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------- |
| Purpose          | Final course-facing manual: story catalog, out-of-scope hackathon listing, **US-030–US-035 chat**, FR mapping  |
| Companion        | Shipped how-to screens: [`user_manual.md`](./user_manual.md) (v2.1)                                      |
| Sources          | [`user_stories.md`](./02_user_stories/user_stories.md), [`functional_nonfunctional_requirements.md`](./04_requirements/functional_nonfunctional_requirements.md), [`task_disaggregation.md`](./05_sprint_1/task_disaggregation.md) |
| Version          | Final · COMP 313 Team 1 · Chat Must-Have slice (≈3 days) + Should/May chat stories                        |

## Contents

1. [Story count](#1-story-count)
2. [Full story index](#2-full-story-index)
3. [Out of scope — hackathon listing (US-008–010 / FR-018–028)](#3-out-of-scope--hackathon-listing-us-008010--fr-018028)
4. [US-030 — Participant chat forums and messaging (NEW)](#4-us-030--participant-chat-forums-and-messaging-new)
5. [FR mapping for chat](#5-fr-mapping-for-chat)
6. [Sprint scope (3-day Must-Have vs next sprint)](#6-sprint-scope-3-day-must-have-vs-next-sprint)
7. [Screenshot placeholders](#7-screenshot-placeholders)

---

## 1. Story count

Canonical backlog was **29** stories. This final manual adds **US-030–US-035** (chat family).

| Bucket | Count | Notes |
| ------ | ----- | ----- |
| Must-Have (shipped) | **17** | US-001–006, 011–013, 015, 017–020, 022, 026, 027 |
| ~~Must-Have (catalog, out of scope)~~ | ~~3~~ | ~~US-008, US-009, US-010~~ (hackathon listing) |
| **Must-Have (new — 3-day sprint slice)** | **1** | **US-030** forums + messages + presence |
| Should-Have | **11** | US-007, 014, 021, 023–025, 028 + **US-031–US-034** |
| May-Have | **3** | US-016, 029 + **US-035** |

---

## 2. Full story index

| ID | Title | Class | Status |
| -- | ----- | ----- | ------ |
| US-001 … US-006 | Auth & profile | Must-Have | Shipped |
| US-007 | Hackathon history | Should-Have | Catalog |
| ~~US-008~~ | ~~Public hackathon discovery~~ | ~~Was Must-Have~~ | ~~**Out of scope**~~ |
| ~~US-009~~ | ~~Event submission~~ | ~~Was Must-Have~~ | ~~**Out of scope**~~ |
| ~~US-010~~ | ~~ADMIN event lifecycle~~ | ~~Was Must-Have~~ | ~~**Out of scope**~~ |
| US-011 … US-013, US-015, US-017 … US-020, US-022 | Recruitment | Must-Have | Shipped |
| US-014 | Advanced candidate search | Should-Have | Catalog |
| US-016 | Recommended teams | May-Have | Catalog |
| US-021 | Notification centre | Should-Have | Catalog (needed with chat later) |
| US-023 | Private workspace (links/notes) | Should-Have | Catalog — **no chat** (FR-069) |
| US-024 | Roster export | Should-Have | Catalog |
| US-025 | Participant reporting | Should-Have | Catalog |
| US-026, US-027 | Moderation & accounts | Must-Have | Shipped |
| US-028 | Audit review UI | Should-Have | Catalog |
| US-029 | Authenticator MFA | May-Have | Catalog |
| **US-030** | **Chat forums & messaging** | **Must-Have** | **NEW (3-day)** |
| **US-031** | **Team-scoped chat channels** | **Should-Have** | **NEW (next sprint)** |
| **US-032** | **Direct messaging** | **Should-Have** | **NEW (next sprint)** |
| **US-033** | **Chat moderation / reporting hooks** | **Should-Have** | **NEW (next sprint)** |
| **US-034** | **Chat unread / mention badges** | **Should-Have** | **NEW (after US-021)** |
| **US-035** | **Rich chat media / realtime extras** | **May-Have** | **NEW (future)** |

---

## 3. Out of scope — hackathon listing (US-008–010 / FR-018–028)

These remain in the historical catalog but are **struck through** for the current application (no public hackathon listing product).

### Struck-through stories

- ~~**US-008** Public hackathon discovery and multi-filter search~~
- ~~**US-009** Participant hackathon event submission~~
- ~~**US-010** ADMIN event verification, correction, and lifecycle~~

### Struck-through FRs (replaced by chat FRs below)

| FR | Was | Status |
| -- | --- | ------ |
| ~~**FR-018**~~ | ~~Public event discovery~~ | ~~Out of scope~~ |
| ~~**FR-019**~~ | ~~Filter public events~~ | ~~Out of scope~~ |
| ~~**FR-020**~~ | ~~Safe official event links~~ | ~~Out of scope~~ |
| ~~**FR-021**~~ | ~~PART can submit events~~ | ~~Out of scope~~ |
| ~~**FR-022**~~ | ~~Pending submissions + duplicate checks~~ | ~~Out of scope~~ |
| ~~**FR-023**~~ | ~~ADMIN event verification queue~~ | ~~Out of scope~~ |
| ~~**FR-024**~~ | ~~ADMIN manage official event records~~ | ~~Out of scope~~ |
| ~~**FR-025**~~ | ~~Resolve duplicate events~~ | ~~Out of scope~~ |
| ~~**FR-026**~~ | ~~Publish approved canonical events~~ | ~~Out of scope~~ |
| ~~**FR-027**~~ | ~~Reject/disable invalid events~~ | ~~Out of scope~~ *(US-026 team URL hide is unrelated)* |
| ~~**FR-028**~~ | ~~Close recruitment at event conclusion~~ | ~~Out of scope~~ |

---

## 4. US-030 — Participant chat forums and messaging (NEW)

**Delivery:** Must-Have (≈3-day slice only)  
**User/Role:** `PART` (verified, active)  
**Related:** US-006 · extensions **US-031–US-035**  
**FRs:** **FR-086–FR-089** only

Deferred chat work is **not** acceptance for US-030 — see separate stories:

| Story | Class | Scope |
| ----- | ----- | ----- |
| **US-031** | Should-Have (next sprint) | Team-scoped channels · FR-090 |
| **US-032** | Should-Have (next sprint) | Direct messages · FR-091 |
| **US-033** | Should-Have (next sprint) | Chat moderation / reporting hooks · FR-092 |
| **US-034** | Should-Have (after US-021) | Unread / mention badges · FR-094 |
| **US-035** | May-Have (future) | Reactions / typing / attachments / voice-video · FR-093 |

Full statements and ACs: [`user_stories.md`](./02_user_stories/user_stories.md#us-030) · tasks: [`task_disaggregation.md`](./05_sprint_1/task_disaggregation.md#us-030).

### Story statement

> As a Participant (hacker), I want in-app forums and messaging with presence statuses, so that I can open topic channels with a title and description, collaborate with other hackers, and send messages in-app.

### Description

Replace the deferred hackathon-listing Must-Have surface with **in-app collaboration chat**. Closest old items: US-023 (links/notes only; **no chat**) and US-021 (alerts, not conversation).

### Acceptance criteria — Must-Have (implement in ≈3 days)

1. Verified active PART can set presence: **Online**, **Idle**, **Do Not Disturb**, **Invisible**. Visitors never see presence.
2. PART can create and list **forums/channels** with required **title** and **description**.
3. Channel members can **send and read text messages** (author handle, timestamp, content). Empty, loading, validation, and error states; drafts kept on failure (NR-017).
4. Visitors / unverified / suspended accounts cannot use chat (401/403 / clear gate).
5. Responses never expose credentials, OTPs, or account emails.
6. Vitest (+ light route tests) cover happy path, invalid input, unauthorized access, and failure handling.

### What the user does (Must-Have UX)

1. Sign in + OTP → open **Chat**.
2. Set presence status.
3. Create a forum (title + description) or open an existing one.
4. Send messages; see peer Online/Idle statuses when visible.

### Screenshots (placeholders)

![Figure 30.1 Status](assets/screenshots/PLACEHOLDER-us-030-figure-30-1-status.png)

**Figure 30.1** Presence status picker.

![Figure 30.2 Forums](assets/screenshots/PLACEHOLDER-us-030-figure-30-2-forums.png)

**Figure 30.2** Forum list + create (title, description).

![Figure 30.3 Messages](assets/screenshots/PLACEHOLDER-us-030-figure-30-3-messages.png)

**Figure 30.3** Message thread + composer.

![Figure 30.4 Denied](assets/screenshots/PLACEHOLDER-us-030-figure-30-4-denied.png)

**Figure 30.4** Access denied for Visitor / unauthorized PART.

### Errors and prompts

| Scenario | User sees |
| -------- | --------- |
| Blank title / blank message | Field error; draft kept |
| Network send failure | Error; draft kept |
| Suspended / unverified | Chat blocked |
| Visitor | Access denied |

---

## 5. FR mapping for chat

| FR | Class | Requirement | Story |
| -- | ----- | ----------- | ----- |
| **FR-086** | **Must-Have** | Presence statuses (Online / Idle / DND / Invisible) for verified PART | US-030 |
| **FR-087** | **Must-Have** | Create/list forums/channels with title + description | US-030 |
| **FR-088** | **Must-Have** | Send/list text messages with author + time; deny unauthorized; keep drafts | US-030 |
| **FR-089** | **Must-Have** | Chat privacy — no credentials/OTPs/emails in chat payloads | US-030 |
| **FR-090** | Should-Have (next) | Team-scoped channels (confirmed members only) | **US-031**, US-012, US-022 |
| **FR-091** | Should-Have (next) | Direct messages between connected PART users | **US-032** |
| **FR-092** | Should-Have (next) | Chat targets openable in US-026; optional US-025 report | **US-033**, US-026, US-025 |
| **FR-094** | Should-Have (next) | Chat unread / mention badges via US-021 | **US-034**, US-021 |
| **FR-093** | May-Have | Attachments / reactions / typing / voice-video | **US-035** |

Official FR table rows are updated in [`functional_nonfunctional_requirements.md`](./04_requirements/functional_nonfunctional_requirements.md).

---

## 6. Sprint scope (3-day Must-Have vs next sprint)

| When | Scope | Stories / FRs |
| ---- | ----- | ------------- |
| **Now (≈3 days) — Must-Have** | Presence + forums + text messaging + privacy + tests | **US-030** · **FR-086–FR-089** |
| **Next sprint — Should-Have** | Team channels, DMs, moderation hooks, unread badges | **US-031–US-034** · **FR-090–FR-092, FR-094** |
| **Later — May-Have** | Rich media / realtime extras | **US-035** · **FR-093** |

Task breakdown: [`task_disaggregation.md`](./05_sprint_1/task_disaggregation.md) → **US-030** … **US-035**.

---

## 7. Screenshot placeholders

Use `docs/assets/screenshots/PLACEHOLDER-us-030-figure-30-*.png` until real captures exist. Do not invent UI for ~~US-008–010~~.

---

HackMatch · COMP 313 · Team 1 — **User manual (final)**.  
~~FR-018–FR-028 / US-008–US-010~~ out of scope · **US-030** Must-Have (3-day) · **US-031–US-034** Should-Have · **US-035** May-Have.
