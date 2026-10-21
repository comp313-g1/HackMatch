# HackMatch User Manual

| Item             | Detail                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------- |
| Scope            | **Implemented** Must-Have MVP stories only (see §1)                                                     |
| Delivery         | Must-Have — MVP                                                                                         |
| Visuals          | **Screenshot placeholders** for every figure — replace with real captures when available                |
| Sources of truth | `docs/02_user_stories/user_stories.md`, `docs/04_requirements/functional_nonfunctional_requirements.md` |
| Version          | v2.1 · Sprint 2 (adds US-026 moderation + US-027 account enforcement)                                   |

## Contents

1. [Scope and exclusions](#1-scope-and-exclusions)
2. [Roles and terminology](#2-roles-and-terminology)
3. [Three ground rules](#3-three-ground-rules)
4. [US-001 Participant registration and email verification](#4-us-001-participant-registration-and-email-verification)
5. [US-002 Federated (OAuth) registration and sign-in](#5-us-002-federated-oauth-registration-and-sign-in)
6. [US-003 Sign-in and session management](#6-us-003-sign-in-and-session-management)
7. [US-004 Email-based login two-factor authentication (OTP)](#7-us-004-email-based-login-two-factor-authentication-otp)
8. [US-005 Password recovery](#8-us-005-password-recovery)
9. [US-006 Participant profile management](#9-us-006-participant-profile-management)
10. [US-011 Declare Looking-for-Team availability](#10-us-011-declare-looking-for-team-availability)
11. [US-012 Create and manage a team listing](#11-us-012-create-and-manage-a-team-listing)
12. [US-013 Browse and filter open team vacancies](#12-us-013-browse-and-filter-open-team-vacancies)
13. [US-015 Candidate recommendations for Team Leads](#13-us-015-candidate-recommendations-for-team-leads)
14. [US-017 Issue a team invitation](#14-us-017-issue-a-team-invitation)
15. [US-018 Apply to join a team vacancy](#15-us-018-apply-to-join-a-team-vacancy)
16. [US-019 Respond to a team invitation](#16-us-019-respond-to-a-team-invitation)
17. [US-020 Approve or decline an application](#17-us-020-approve-or-decline-an-application)
18. [US-022 Confirm and lock a team roster](#18-us-022-confirm-and-lock-a-team-roster)
19. [US-026 Administrative content moderation and safety queue](#19-us-026-administrative-content-moderation-and-safety-queue)
20. [US-027 Administrative account management and enforcement](#20-us-027-administrative-account-management-and-enforcement)
21. [Appendix A Requirement mapping](#appendix-a-requirement-mapping)
22. [Appendix B How to replace screenshot placeholders](#appendix-b-how-to-replace-screenshot-placeholders)

## 1. Scope and exclusions

This manual describes what a user can see, do, and be told by the system for **Must-Have stories that are implemented in the current product**. It is not an implementation specification.

| Topic              | Description                                                                                                                                                                                                 |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **In scope**       | US-001, US-002, US-003, US-004, US-005, US-006, US-011, US-012, US-013, US-015, US-017, US-018, US-019, US-020, US-022, **US-026**, **US-027**                                                                 |
| **Out of scope**   | Must-Have stories **not yet implemented** in the client: US-008, US-009, US-010 (hackathon listing / ADMIN event lifecycle). Should-Have / May-Have stories (US-007, US-014, US-016, US-021, US-023–025, US-028–029). |
| Screenshots        | Every figure uses a **placeholder** image path under `docs/assets/screenshots/`. Replace with a real product capture; do not invent UI the product does not show.                                           |

## 2. Roles and terminology

| Identifier | Meaning                 | What it does in this manual                                                                                                                      |
| ---------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `VISITOR`  | Unauthenticated visitor | Can register or start OAuth; cannot use protected recruitment or admin features.                                                                 |
| `PART`     | Participant account     | Public registration target. Can maintain a profile, declare availability, browse/apply, own or join teams. Cannot open Moderation or Accounts.   |
| `LEAD`     | Team owner context      | Not a global role — ownership of a specific team (invite, review applications, lock roster). May see moderation status on their own listing.     |
| `ADMIN`    | Platform administrator  | Provisioned only by a deployment operator (custom claim). Sees **Moderation** and **Accounts** nav after OTP. No public path creates `ADMIN`.   |

- **Unverified** — account exists, mailbox not proven; team features stay gated.
- **Pre-authentication** — password or OAuth succeeded, but the email login code has not; no usable session yet.
- **Suspended** — ADMIN enforcement state; sessions cannot renew and sign-in is blocked (see §20).
- **Deactivated** — ownership-verified deletion completed; live identifying fields are erased.

## 3. Three ground rules

> **Rule one:** Verifying email ownership does **not** create a full login session. US-004 OTP must succeed.

> **Rule two:** Every sign-in (email/password, Google, GitHub) continues to the email login code. Provider MFA does not replace it.

> **Rule three:** No public entry point ever yields an administrator.

---

## 4. US-001 Participant registration and email verification

**Delivery** Must-Have / MVP · **Role** `VISITOR`

> As an unauthenticated visitor, I want to create an account with my email and password and verify my email address, so that I can establish a verified Participant profile.

### 4.1 What the user does

1. Open **Register** and enter full name, email, and password (8+ characters, mixed case, digit, special character).
2. Submit; a verification email is sent. The account is Unverified until the link is used.
3. Open the email and follow the link. Success marks the account Verified but does **not** sign you in.
4. Sign in normally (including the login code). Unverified accounts cannot create teams, declare availability, apply, or accept invitations.

### 4.2 Screenshots (placeholders)

> **[Screenshot placeholder]** Registration form (name, email, password checklist, Google/GitHub entry).

![Figure 1.1 Registration form — screenshot placeholder](assets/screenshots/PLACEHOLDER-us-001-figure-1-1-registration.png)

**Figure 1.1** Registration form — only public path that creates a `PART` account (no role selector).

> **[Screenshot placeholder]** Verification waiting / gate state.

![Figure 1.2 Verification gate — screenshot placeholder](assets/screenshots/PLACEHOLDER-us-001-figure-1-2-verification-gate.png)

**Figure 1.2** Verification gate — account exists; interactive recruitment stays blocked until verified.

> **[Screenshot placeholder]** Link success or invalid/expired link message.

![Figure 1.3 Verification outcome — screenshot placeholder](assets/screenshots/PLACEHOLDER-us-001-figure-1-3-verification-outcome.png)

**Figure 1.3** Verification outcome — success changes state only; failure offers a replacement link.

### 4.3 Errors and prompts

| Scenario                              | What the user sees                                      |
| ------------------------------------- | ------------------------------------------------------- |
| Invalid or already-registered email   | Field error; no account created.                        |
| Weak password                         | Checklist flags the failing rule; submit stays blocked. |
| Expired / used / tampered link        | Link no longer valid; request a new verification email. |
| Team action while unverified          | Blocked and sent back to verification.                  |

---

## 5. US-002 Federated (OAuth) registration and sign-in

**Delivery** Must-Have / MVP · **Role** `VISITOR` / `PART`

> As a visitor or Participant, I want to register and sign in using Google or GitHub, so that I can access the platform quickly without creating separate credentials.

### 5.1 What the user does

1. Choose **Continue with Google** or **Continue with GitHub**.
2. Complete provider consent (or cancel).
3. With a verified provider email, a `PART` account is provisioned (or an existing account is used after re-auth + OTP when linking).
4. Every successful provider path continues to the **email login code** (US-004).

### 5.2 Screenshots (placeholders)

> **[Screenshot placeholder]** Sign-in / register entry with Google and GitHub buttons.

![Figure 2.1 OAuth entry — screenshot placeholder](assets/screenshots/PLACEHOLDER-us-002-figure-2-1-oauth-entry.png)

**Figure 2.1** OAuth entry — Google, GitHub, and email/password converge here.

> **[Screenshot placeholder]** Provider cancel / missing verified email message.

![Figure 2.2 OAuth callback failure — screenshot placeholder](assets/screenshots/PLACEHOLDER-us-002-figure-2-2-oauth-callback.png)

**Figure 2.2** Callback failure — no session created; missing verified email routes to email registration.

### 5.3 Errors and prompts

| Scenario                         | What the user sees                                              |
| -------------------------------- | --------------------------------------------------------------- |
| Consent cancelled / provider error | Actionable message; no session.                               |
| No verified email from provider  | Routed to email registration / verification.                     |
| Existing email account           | Re-authentication + OTP required; email text alone does not link. |

---

## 6. US-003 Sign-in and session management

**Delivery** Must-Have / MVP · **Role** `PART` / `ADMIN`

> As a Participant or Administrator, I want to sign in, maintain an authorized session, and sign out, so that I can safely use my authorized functions.

### 6.1 What the user does

1. Enter email and password (or use OAuth).
2. Complete the email login code (US-004) before any protected feature unlocks.
3. Use the app while the session is live; sign out to revoke the current session.

### 6.2 Screenshots (placeholders)

> **[Screenshot placeholder]** Sign-in form with generic error / lockout guidance.

![Figure 3.1 Sign-in — screenshot placeholder](assets/screenshots/PLACEHOLDER-us-003-figure-3-1-sign-in.png)

**Figure 3.1** Sign-in — uniform “email or password incorrect” messages; forgot-password entry.

> **[Screenshot placeholder]** Signed-in navigation / account area and Sign out.

![Figure 3.2 Session and sign-out — screenshot placeholder](assets/screenshots/PLACEHOLDER-us-003-figure-3-2-session.png)

**Figure 3.2** Active session — protected nav (teams, availability, applications, invitations; ADMIN also sees Moderation and Accounts); Sign out.

### 6.3 Errors and prompts

| Scenario                    | What the user sees                                                                 |
| --------------------------- | ---------------------------------------------------------------------------------- |
| Wrong password              | Generic failure (does not reveal whether email exists).                            |
| Suspended account           | Access denied (`ACCOUNT_SUSPENDED`); cannot start or renew a session (US-027).     |
| Replay after sign-out       | Protected requests fail.                                                           |

---

## 7. US-004 Email-based login two-factor authentication (OTP)

**Delivery** Must-Have / MVP · **Role** `PART` / `ADMIN`

> As a Participant or Platform Administrator, I want to verify my identity via a one-time code sent to my email during login, so that a compromised password alone does not grant account access.

### 7.1 What the user does

1. Complete primary sign-in; a **6-digit code** is emailed (valid **10 minutes**).
2. Enter the code and verify. Success unlocks the session.
3. Use **Resend** if needed (invalidates the previous code; does not reset the failure counter).
4. After **five** incorrect codes, the account locks for **15 minutes**.

### 7.2 Screenshots (placeholders)

> **[Screenshot placeholder]** Enter verification code screen.

![Figure 4.1 OTP entry — screenshot placeholder](assets/screenshots/PLACEHOLDER-us-004-figure-4-1-otp-entry.png)

**Figure 4.1** Enter verification code — mandatory gate after password or OAuth.

> **[Screenshot placeholder]** Resend / cooldown.

![Figure 4.2 Resend — screenshot placeholder](assets/screenshots/PLACEHOLDER-us-004-figure-4-2-resend.png)

**Figure 4.2** Resend — new challenge; previous code retired.

> **[Screenshot placeholder]** Wrong / expired / used code error.

![Figure 4.3 OTP errors — screenshot placeholder](assets/screenshots/PLACEHOLDER-us-004-figure-4-3-otp-errors.png)

**Figure 4.3** OTP errors — no access granted.

> **[Screenshot placeholder]** 15-minute lockout banner.

![Figure 4.4 Lockout — screenshot placeholder](assets/screenshots/PLACEHOLDER-us-004-figure-4-4-lockout.png)

**Figure 4.4** Five-attempt lockout — verify/resend disabled until wait ends.

> **[Screenshot placeholder]** Email delivery failure + Try sending again.

![Figure 4.5 Delivery failure — screenshot placeholder](assets/screenshots/PLACEHOLDER-us-004-figure-4-5-delivery-failure.png)

**Figure 4.5** Send failure — no session; safe retry.

---

## 8. US-005 Password recovery

**Delivery** Must-Have / MVP · **Role** `PART` / `ADMIN`

> As a user, I want to request a secure password reset link via my registered email, so that I can regain access if I forget my password.

### 8.1 What the user does

1. From sign-in, open **Forgot password** and submit the email.
2. The UI shows the **same generic confirmation** whether or not the address is known.
3. Open a valid reset link, set a policy-compliant password, then **sign in again** (including OTP). Reset does **not** auto-login or skip MFA.

### 8.2 Screenshots (placeholders)

> **[Screenshot placeholder]** Forgot-password request form and generic confirmation.

![Figure 5.1 Recovery request — screenshot placeholder](assets/screenshots/PLACEHOLDER-us-005-figure-5-1-request.png)

**Figure 5.1** Password recovery request — enumeration-safe confirmation.

> **[Screenshot placeholder]** Reset password form (valid link) or invalid/expired link state.

![Figure 5.2 Reset form — screenshot placeholder](assets/screenshots/PLACEHOLDER-us-005-figure-5-2-reset-form.png)

**Figure 5.2** Reset form — success requires a later full sign-in with OTP.

### 8.3 Errors and prompts

| Scenario                         | What the user sees                                      |
| -------------------------------- | ------------------------------------------------------- |
| Unknown or known email           | Same generic “check your email” style confirmation.     |
| Expired / used reset link        | Cannot change password; request a new link.             |
| OAuth-only guidance              | Directed to provider recovery without revealing type.   |

---

## 9. US-006 Participant profile management

**Delivery** Must-Have / MVP · **Role** `PART`

> As a Participant, I want to maintain my technical profile with my role, skill tags, academic institution, and portfolio links, so that prospective teammates can assess my capabilities.

### 9.1 What the user does

1. Open **Profile** while signed in.
2. Edit handle, primary role, institution, skills, HTTPS portfolio links, and optional shared contact handle.
3. Save; invalid fields show errors without wiping other entered values.
4. Visitors cannot open participant cards; teammates see only permitted fields (never account email).

### 9.2 Screenshots (placeholders)

> **[Screenshot placeholder]** Profile editor form.

![Figure 6.1 Profile editor — screenshot placeholder](assets/screenshots/PLACEHOLDER-us-006-figure-6-1-profile-editor.png)

**Figure 6.1** Profile editor — self-declared skills and portfolio URLs.

> **[Screenshot placeholder]** Candidate profile card (authenticated view).

![Figure 6.2 Candidate card — screenshot placeholder](assets/screenshots/PLACEHOLDER-us-006-figure-6-2-candidate-card.png)

**Figure 6.2** Candidate card — permitted fields only; email never shown.

---

## 10. US-011 Declare Looking-for-Team availability

**Delivery** Must-Have / MVP · **Role** `PART`

> As a Participant, I want to declare my availability for a specific hackathon and state my desired role and commitment level, so that Team Leads can discover me as an available candidate.

### 10.1 What the user does

1. Open **Looking for Team** for a verified recruiting event (no confirmed membership on that event).
2. Set desired role, commitment hours, and goal (Learning / Project Completion / Competitive).
3. Toggle Looking for Team on. Placement on a team clears availability for that event.

### 10.2 Screenshots (placeholders)

> **[Screenshot placeholder]** Looking-for-Team form / toggle.

![Figure 11.1 LFT form — screenshot placeholder](assets/screenshots/PLACEHOLDER-us-011-figure-11-1-lft-form.png)

**Figure 11.1** Looking-for-Team — event-scoped preferences.

---

## 11. US-012 Create and manage a team listing

**Delivery** Must-Have / MVP · **Role** `PART` (becomes Team Lead on creation)

> As a Team Lead, I want to create a structured recruitment listing with discrete skill vacancy slots and edit it as our needs evolve, so that I can attract targeted teammates.

### 11.1 What the user does

1. Create a team for a verified recruiting event (name, pitch ≤ 500 chars, goal, hours, optional communication link).
2. As owner, edit listing, add/update/remove open slots, remove non-owner members (with reason), or disband **before lock**.
3. Confirmed members see a read-only roster status view; owners use the team workspace controls.
4. If an ADMIN hides the listing (US-026), the owner still opens the workspace and sees a clear moderation status notice; ordinary discovery no longer shows the team.

### 11.2 Screenshots (placeholders)

> **[Screenshot placeholder]** Create team form.

![Figure 12.1 Create team — screenshot placeholder](assets/screenshots/PLACEHOLDER-us-012-figure-12-1-create-team.png)

**Figure 12.1** Create team — owner becomes first confirmed member.

> **[Screenshot placeholder]** Owner workspace (listing + vacancies + roster).

![Figure 12.2 Team workspace — screenshot placeholder](assets/screenshots/PLACEHOLDER-us-012-figure-12-2-workspace.png)

**Figure 12.2** Team workspace — edit listing, open slots, roster, disband (unlocked only).

> **[Screenshot placeholder]** Member roster status (non-owner).

![Figure 12.3 Member roster status — screenshot placeholder](assets/screenshots/PLACEHOLDER-us-012-figure-12-3-member-status.png)

**Figure 12.3** Member view — roster status without owner controls.

> **[Screenshot placeholder]** Owner moderation status notice after ADMIN hide.

![Figure 12.4 Moderation status notice — screenshot placeholder](assets/screenshots/PLACEHOLDER-us-012-figure-12-4-moderation-status.png)

**Figure 12.4** Moderation status — owner-visible notice when the listing is hidden or link-removed (US-026).

---

## 12. US-013 Browse and filter open team vacancies

**Delivery** Must-Have / MVP · **Role** `PART`

> As a Participant, I want to browse and filter open team vacancy slots for a hackathon, so that I can identify teams matching my technical stack and project goals.

### 12.1 What the user does

1. Open **Browse teams** for the selected event.
2. Filter by skills, role, goal, and open-slot counts.
3. Inspect pitch and vacancy requirements; start an application (US-018) from an open slot.
4. Empty results show a clear empty state and filter reset.

### 12.2 Screenshots (placeholders)

> **[Screenshot placeholder]** Open teams board with filters.

![Figure 13.1 Open teams board — screenshot placeholder](assets/screenshots/PLACEHOLDER-us-013-figure-13-1-board.png)

**Figure 13.1** Open teams board — active unlocked teams with open slots.

> **[Screenshot placeholder]** Empty / no matches state.

![Figure 13.2 Empty filters — screenshot placeholder](assets/screenshots/PLACEHOLDER-us-013-figure-13-2-empty.png)

**Figure 13.2** No matches — empty guidance and reset.

---

## 13. US-015 Candidate recommendations for Team Leads

**Delivery** Must-Have / MVP · **Role** `LEAD` (team owner)

> As a Team Lead, I want ranked eligible Looking-for-Team candidates for an open slot, so that I can invite strong fits quickly.

### 13.1 What the user does

1. In the team workspace, open recommendations for an **open** vacancy.
2. Review ranked eligible candidates (explainable scores / eligibility messages).
3. Start an invitation draft (US-017) for an eligible candidate.
4. Empty or degraded states show clear guidance (no silent blank list).

### 13.2 Screenshots (placeholders)

> **[Screenshot placeholder]** Recommendation list for an open slot.

![Figure 15.1 Recommendations — screenshot placeholder](assets/screenshots/PLACEHOLDER-us-015-figure-15-1-list.png)

**Figure 15.1** Candidate recommendations — invite from an eligible row.

---

## 14. US-017 Issue a team invitation

**Delivery** Must-Have / MVP · **Role** `LEAD`

> As a Team Lead, I want to invite a Looking-for-Team candidate to a specific open slot, so that we can form a team with clear pending status.

### 14.1 What the user does

1. Choose an open slot and an eligible candidate (from recommendations or invite flow).
2. Send the invitation (48-hour pending window applies).
3. Review outbound invitations; cancel a pending invite when needed.
4. Locked / non-mutable teams reject new invitations.

### 14.2 Screenshots (placeholders)

> **[Screenshot placeholder]** Issue invitation / draft.

![Figure 17.1 Issue invitation — screenshot placeholder](assets/screenshots/PLACEHOLDER-us-017-figure-17-1-issue.png)

**Figure 17.1** Issue invitation — one pending invite per slot and invitee/team rules apply.

> **[Screenshot placeholder]** Owner outbound invitations list.

![Figure 17.2 Outbound invitations — screenshot placeholder](assets/screenshots/PLACEHOLDER-us-017-figure-17-2-outbound.png)

**Figure 17.2** Outbound invitations — status and cancel for Pending rows.

---

## 15. US-018 Apply to join a team vacancy

**Delivery** Must-Have / MVP · **Role** `PART`

> As a Participant, I want to apply to an open team vacancy with a short pitch, so that Team Leads can review my interest.

### 15.1 What the user does

1. From browse teams, choose an open slot and submit an application (optional short message, length-limited).
2. Track status under **My Applications**; withdraw a Pending Review application when allowed.
3. Duplicate pending apps and event pending limits are blocked with clear messages.

### 15.2 Screenshots (placeholders)

> **[Screenshot placeholder]** Application form for an open slot.

![Figure 18.1 Application form — screenshot placeholder](assets/screenshots/PLACEHOLDER-us-018-figure-18-1-apply.png)

**Figure 18.1** Apply — open slot, message, submit.

> **[Screenshot placeholder]** My Applications list (including withdraw).

![Figure 18.2 My Applications — screenshot placeholder](assets/screenshots/PLACEHOLDER-us-018-figure-18-2-mine.png)

**Figure 18.2** My Applications — status inspect and withdraw.

---

## 16. US-019 Respond to a team invitation

**Delivery** Must-Have / MVP · **Role** `PART` (invitee)

> As a Participant, I want to accept or decline a team invitation, so that I can join a team or leave the offer closed without duplicate memberships.

### 16.1 What the user does

1. Open **Invitations** to see inbound Pending invites.
2. Review detail; **Accept** or **Decline**.
3. Accept confirms membership (when eligible), fills the slot, and clears Looking-for-Team for that event.
4. Before lock, a non-owner confirmed member may **Leave** the team from roster status.

### 16.2 Screenshots (placeholders)

> **[Screenshot placeholder]** My Invitations list and detail with Accept / Decline.

![Figure 19.1 My Invitations — screenshot placeholder](assets/screenshots/PLACEHOLDER-us-019-figure-19-1-inbox.png)

**Figure 19.1** My Invitations — accept / decline for Pending invites.

> **[Screenshot placeholder]** Leave team confirmation (pre-lock member).

![Figure 19.2 Leave team — screenshot placeholder](assets/screenshots/PLACEHOLDER-us-019-figure-19-2-leave.png)

**Figure 19.2** Leave team — available only before roster lock; owners must disband instead.

---

## 17. US-020 Approve or decline an application

**Delivery** Must-Have / MVP · **Role** `LEAD`

> As a Team Lead, I want to approve or decline Pending Review applications, so that I can fill open slots without overbooking.

### 17.1 What the user does

1. In the team workspace, open the applications review queue.
2. Inspect permitted applicant profile fields and pitch.
3. **Approve** (atomic slot fill / membership) or **Decline**.
4. Stale or already-decided rows show a clear conflict without duplicate writes.

### 17.2 Screenshots (placeholders)

> **[Screenshot placeholder]** Owner application review queue with Approve / Decline.

![Figure 20.1 Application review — screenshot placeholder](assets/screenshots/PLACEHOLDER-us-020-figure-20-1-review.png)

**Figure 20.1** Application review — owner-only decisions for Pending Review.

---

## 18. US-022 Confirm and lock a team roster

**Delivery** Must-Have / MVP · **Role** `LEAD`

> As a Team Lead, I want to confirm and lock my team's roster once we have at least the official minimum confirmed members, so that membership is finalized and further roster mutations are frozen.

### 18.1 What the user does

1. In **Confirm & lock roster**, re-check eligibility (confirmed members between event minimum and maximum; platform floor is **2**).
2. Review the confirmed member list.
3. Open **Confirm & Lock Roster**, read the irreversible warning, then confirm.
4. After lock: pending invitations/applications are canceled; leave, removals, slot edits, and disband are blocked; members see a **Locked** badge and lock time.

### 18.2 Screenshots (placeholders)

> **[Screenshot placeholder]** Confirm & lock panel (eligible / blocked reasons).

![Figure 22.1 Lock eligibility — screenshot placeholder](assets/screenshots/PLACEHOLDER-us-022-figure-22-1-eligibility.png)

**Figure 22.1** Lock eligibility — roster review and Confirm & Lock when eligible.

> **[Screenshot placeholder]** Lock confirmation dialog.

![Figure 22.2 Lock confirmation — screenshot placeholder](assets/screenshots/PLACEHOLDER-us-022-figure-22-2-confirm-dialog.png)

**Figure 22.2** Lock confirmation — permanent freeze warning before submit.

> **[Screenshot placeholder]** Locked roster badge / status for owner or member.

![Figure 22.3 Locked status — screenshot placeholder](assets/screenshots/PLACEHOLDER-us-022-figure-22-3-locked-status.png)

**Figure 22.3** Locked status — Locked badge, server lock time, read-only controls.

### 18.3 Errors and prompts

| Scenario                         | What the user sees                                                |
| -------------------------------- | ----------------------------------------------------------------- |
| Only 1 confirmed member          | Lock blocked: need at least the minimum (typically 2).            |
| Over maximum members             | Lock blocked: too many confirmed members.                         |
| Non-owner attempts lock          | Forbidden — owner only.                                           |
| Leave / edit / disband after lock | Rejected; UI controls disabled; clear locked roster message.     |

---

## 19. US-026 Administrative content moderation and safety queue

**Delivery** Must-Have / MVP · **Role** `ADMIN` (PART / Visitor denied)

> As a Platform Administrator, I want to review flagged team content and malicious links in a moderation queue, so that the platform remains safe, compliant, and free of phishing threats.

### 19.1 What the ADMIN does

1. Sign in as an operator-provisioned `ADMIN`, complete the email login code (US-004), then open **Moderation** in the nav.
2. Review the safety queue (**newest cases first**). Each row shows target type, short target id, reason, time, and report count when present.
3. Open a case to inspect safe target detail (team listing, profile summary, or flagged URL). Credentials and private contacts are never shown.
4. Optionally **open a new case** with target type (`team` / `profile` / `url`), target UUID, mandatory reason, and https flagged URL when the target is a URL.
5. Decide with a mandatory reason: dismiss, redact text, warn, hide listing, or disable a malicious URL. A basic action record is written for each decision.
6. After hide or URL disable, ordinary discovery excludes the unsafe content; team owners can still see status on their workspace (see Figure 12.4).

### 19.2 What PART and Visitors see

- **Moderation** controls and APIs return access denied (401 / 403). There is no public reporting modal yet (US-025 is post-MVP).
- Hidden team listings disappear from **Browse teams**; owners keep a status notice in the team workspace.

### 19.3 Screenshots (placeholders)

> **[Screenshot placeholder]** Safety queue (newest first).

![Figure 26.1 Moderation queue — screenshot placeholder](assets/screenshots/PLACEHOLDER-us-026-figure-26-1-queue.png)

**Figure 26.1** Safety queue — cases ordered newest first with target, reason, and time.

> **[Screenshot placeholder]** Open moderation case form.

![Figure 26.2 Open case form — screenshot placeholder](assets/screenshots/PLACEHOLDER-us-026-figure-26-2-open-case.png)

**Figure 26.2** Open a case — target type, UUID, reason; https URL when target is `url`. Draft values stay if validation fails.

> **[Screenshot placeholder]** Case detail + decide actions.

![Figure 26.3 Case decide panel — screenshot placeholder](assets/screenshots/PLACEHOLDER-us-026-figure-26-3-decide.png)

**Figure 26.3** Case view — safe target summary, decide actions with mandatory reason, success/error banners.

> **[Screenshot placeholder]** Access denied for non-ADMIN.

![Figure 26.4 Moderation access denied — screenshot placeholder](assets/screenshots/PLACEHOLDER-us-026-figure-26-4-access-denied.png)

**Figure 26.4** Access denied — PART or Visitor cannot use the safety queue.

### 19.4 Errors and prompts

| Scenario                         | What the user sees                                                                 |
| -------------------------------- | ---------------------------------------------------------------------------------- |
| Missing / blank decide reason    | Field error; entered values kept.                                                  |
| Case already closed              | Clear closed-case message; decide actions unavailable.                             |
| Invalid target UUID / http URL   | Validation errors with draft preserved.                                            |
| PART or Visitor opens Moderation | Access denied; no queue data.                                                     |
| Hide / disable URL success       | Success notice; listing/link removed from ordinary discovery; action recorded.     |

---

## 20. US-027 Administrative account management and enforcement

**Delivery** Must-Have / MVP · **Role** `ADMIN` (PART / Visitor denied)

> As a Platform Administrator, I want to suspend or deactivate non-compliant accounts, so that bad actors cannot harass students or disrupt team formation.

### 20.1 What the ADMIN does

1. Sign in as `ADMIN`, complete OTP, then open **Accounts** in the nav.
2. Search and filter accounts by text, state (Active / Suspended / Deactivated), and role (PART / ADMIN). Select a row to inspect detail.
3. Review account identifier, role, state, profile summary, and relevant team listings. Credentials, OTPs, and private team notes are never shown.
4. **Suspend** with a mandatory reason. The system revokes sessions, blocks sign-in, cancels pending invitations/applications, hides the profile, clears Looking-for-Team, and pauses recruitment on owned unlocked Open teams. Confirmed memberships stay intact.
5. **Ownership-verified deletion** with a mandatory reason and ownership confirmation checkbox. Live identifying data enters the deletion workflow under a proposed **30-day** processing target (product policy R-06 / NR-023 — not an automatic legal-compliance claim). Historical locked-roster identity fields are pseudonymized; membership rows are kept.
6. If the target still owns unlocked teams, deletion is **blocked** until those teams are disbanded; the entered reason and confirmation stay on screen.

### 20.2 What PART and Visitors see

- **Accounts** controls and APIs return access denied.
- A suspended participant cannot renew a session or use protected features (clear `ACCOUNT_SUSPENDED` denial).
- Public registration never offers an `ADMIN` role (self-promotion forbidden).

### 20.3 Screenshots (placeholders)

> **[Screenshot placeholder]** Account list with search and filters.

![Figure 27.1 Account list — screenshot placeholder](assets/screenshots/PLACEHOLDER-us-027-figure-27-1-list.png)

**Figure 27.1** Accounts list — search, state/role filters, empty and error states; selection opens detail.

> **[Screenshot placeholder]** Account detail (safe fields only).

![Figure 27.2 Account detail — screenshot placeholder](assets/screenshots/PLACEHOLDER-us-027-figure-27-2-detail.png)

**Figure 27.2** Account detail — identifier, role, state, profile summary, relevant listings, privacy notice.

> **[Screenshot placeholder]** Suspend account reason form.

![Figure 27.3 Suspend form — screenshot placeholder](assets/screenshots/PLACEHOLDER-us-027-figure-27-3-suspend.png)

**Figure 27.3** Suspend form — mandatory reason, cascade success notice, draft kept on validation/API failure.

> **[Screenshot placeholder]** Ownership-verified deletion form.

![Figure 27.4 Deletion form — screenshot placeholder](assets/screenshots/PLACEHOLDER-us-027-figure-27-4-delete.png)

**Figure 27.4** Deletion form — reason + ownership checkbox; blocked-until-disband or 30-day target success outcomes.

> **[Screenshot placeholder]** Access denied for non-ADMIN.

![Figure 27.5 Accounts access denied — screenshot placeholder](assets/screenshots/PLACEHOLDER-us-027-figure-27-5-access-denied.png)

**Figure 27.5** Access denied — only platform administrators manage accounts.

### 20.4 Errors and prompts

| Scenario                                      | What the user sees                                                                 |
| --------------------------------------------- | ---------------------------------------------------------------------------------- |
| Blank suspend / delete reason                 | Field error; draft kept.                                                           |
| Ownership not confirmed                       | Checkbox error; reason draft kept.                                                 |
| Unlocked owner has not disbanded              | Deletion blocked with team names; draft kept.                                      |
| Firebase / revoke failure on suspend          | Explicit failure; account may already be marked suspended — retry guidance.        |
| PART or Visitor opens Accounts                | Access denied.                                                                     |
| Suspended user tries to sign in / renew       | Access denied; no usable session.                                                  |

---

## Appendix A Requirement mapping

| Stories (implemented)     | User-facing theme                                                                 |
| ------------------------- | --------------------------------------------------------------------------------- |
| US-001 – US-004           | Registration, OAuth, session, email OTP                                           |
| US-005                    | Password recovery without bypassing OTP                                           |
| US-006                    | Profile fields and privacy boundaries                                             |
| US-011                    | Looking-for-Team availability                                                     |
| US-012                    | Team create / edit / vacancies / remove / disband (pre-lock); moderation status   |
| US-013                    | Browse / filter open teams                                                        |
| US-015                    | Owner candidate recommendations                                                   |
| US-017 – US-020           | Invite, apply, accept/decline, owner application decisions                        |
| US-022                    | Confirm & lock roster; freeze post-lock mutations                                 |
| US-026                    | ADMIN safety queue, case open/decide, hide listing / disable URL                  |
| US-027                    | ADMIN account inspect, suspend cascade, ownership-verified deletion               |

Detailed FR/NR identifiers remain in `docs/04_requirements/functional_nonfunctional_requirements.md`.

---

## Appendix B How to replace screenshot placeholders

1. Capture the real UI for each figure caption above (including new US-026 / US-027 figures).
2. Save under `docs/assets/screenshots/` using the same `PLACEHOLDER-us-…` filename, **or** update the image path in this file.
3. Keep figure numbers and captions stable so reviewers can match acceptance checklists.
4. Until a real capture exists, leave the placeholder path in place (broken-image is expected in preview).
5. Do not add screenshots for Must-Have stories that are **not** implemented yet (US-008, US-009, US-010).

---

HackMatch · COMP 313 Project 2 · Team 1 — User manual (implemented Must-Have stories only).

Where this manual and a source document disagree, `docs/02_user_stories/user_stories.md` and `docs/04_requirements/functional_nonfunctional_requirements.md` win.
