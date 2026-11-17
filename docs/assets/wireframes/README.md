# HackMatch Wireframes

This folder contains wireframes and screenshots for the current HackMatch application, organized by active MVP User Story.

## Coverage

The wireframes cover the implemented user-facing workflows for:

- US-001–US-006
- US-011–US-013
- US-015
- US-017–US-020
- US-022
- US-026–US-027
- US-030

US-008, US-009, and US-010 are deprecated and are intentionally excluded.

Post-MVP or backend-only stories without meaningful implemented UI are not represented.

## Iteration 2 coverage

Every Iteration 2 User Story has one representative capture, except US-035. US-035 has two, because a single screen cannot show its message controls and its realtime typing indicator together.

| User Story | Title | Wireframe | What it shows |
|---|---|---|---|
| US-014 | Advanced Candidate Directory Search and Filter for Team Leads | `US-014-candidate-directory-search.png` | Candidate filters and participant-safe search results |
| US-016 | Recommended Teams for Participants (Future Scope) | `US-016-recommended-teams.png` | Ranked team suggestions with match percentage, matched skills, and apply actions |
| US-021 | In-App Notification Center and Real-Time Recruitment Alerts | `US-021-notification-bell-dropdown.png` | Unread notification badge, dropdown, and mark-read actions |
| US-023 | Team Private Coordination Workspace | `US-023-private-coordination-workspace.png` | Locked-team private workspace |
| US-024 | Export Team Manifest and Check-In Verification Card | `US-024-team-manifest-export.png` | Check-in card, export formats, and checksum verification |
| US-025 | User Reporting Modal for Abusive Content and Malicious Links | `US-025-report-abuse-modal.png` | Participant report dialog opened from an open-team listing |
| US-028 | Administrative Audit Review and Filtering | `US-028-admin-audit-log.png` | ADMIN audit filters and empty state |
| US-029 | Authenticator-App Two-Factor Authentication (Future Scope) | `US-029-authenticator-app-management.png` | Authenticator-app management card before setup; email codes remain the fallback |
| US-031 | Team-Scoped Chat Channels | `US-031-team-chat.png` | Private team chat on a locked team |
| US-032 | Direct Messaging Between Participants | `US-032-direct-messages.png` | Direct-message inbox, selected conversation, and Block control |
| US-033 | Chat Moderation and Reporting Hooks | `US-033-admin-chat-moderation-case.png` | ADMIN safety queue with the case form targeting a chat message |
| US-034 | Chat Unread and Mention Badges | `US-034-chat-unread-mention-badges.png` | Unread and `@mention` badges on the conversation, Direct messages tab, and chat button |
| US-035 | Rich Chat Media and Realtime Extras | `US-035-reaction-picker.png` | Reaction picker and a sent attachment with the **Not scanned for malware** label and Preview/Download controls |
| US-035 | Rich Chat Media and Realtime Extras | `US-035-typing-indicator.png` | Realtime typing indicator between two signed-in participants |

US-007 is done but outside active Iteration 2 scope, and US-030 is not an Iteration 2 story. Neither has an Iteration 2 wireframe; the existing US-030 captures above are unchanged. Voice/video for US-035 is deferred and is not shown.

## Inventory

| Set | PNG files |
|---|---:|
| Earlier wireframes | 21 |
| Iteration 2 wireframes | 14 |
| **Total** | **35** |

## Notes

- Screenshots use a consistent 1440 × 1000 viewport.
- Demo emails were hidden where necessary.
- No passwords, OTP values, tokens, credentials, or private environment data are included.
- US-026 shows the current empty moderation-queue state.
- Iteration 2 captures come from the running application signed in with demo accounts. The US-014, US-021, US-023, US-024, US-028, US-031, US-032, and US-035 files are unmodified copies of the product screenshots in [`../screenshots/`](../screenshots/README.md).
- US-029 hides the demo email address, as in the US-004 wireframe. It shows authenticator management only; sign-in still uses email OTP, and no enrollment secret or QR code is shown.
- US-025 uses the open-team Skills filter so only demo teams appear behind the dialog.
- US-034 shows a direct message sent from the Casey demo account to the Avery demo account through the normal chat screen.
