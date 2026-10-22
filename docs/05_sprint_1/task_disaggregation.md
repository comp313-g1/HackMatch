# Sprint 1 Task Disaggregation

#### [US-001](../02_user_stories/user_stories.md#us-001)

**As an unauthenticated visitor, I want to create an account with my email and password and verify my email address, so that I can establish a verified Participant profile.**

| Task | Description | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|---:|
| Create Firebase Auth registration form for full name, email, and password | Complete the task "Create Firebase Auth registration form for full name, email, and password" for US-001. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | sahil | 2 |  |
| Connect Firebase Auth email/password registration and password-policy validation | Complete the task "Connect Firebase Auth email/password registration and password-policy validation" for US-001. Implement the Node.js/Express API or Firebase Auth integration with server-side validation, authorization, and explicit failure responses. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Po-kai | 2 |  |
| Create PostgreSQL participant profile record with PART role and Unverified state | Complete the task "Create PostgreSQL participant profile record with PART role and Unverified state" for US-001. Implement the Supabase PostgreSQL model or data operation with the required keys, constraints, indexes, and transaction behavior. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Joel | 2 |  |
| Send and process Firebase email verification links | Complete the task "Send and process Firebase email verification links" for US-001. Implement the Node.js/Express API or Firebase Auth integration with server-side validation, authorization, and explicit failure responses. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Edgar | 1.5 |  |
| Block unverified team, availability, application, and invitation actions | Complete the task "Block unverified team, availability, application, and invitation actions" for US-001. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Mohmedjuber | 1 |  |
| Protect ADMIN provisioning from public registration | Complete the task "Protect ADMIN provisioning from public registration" for US-001. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Wei |  |  |
| Add React verification, replacement-link, and invalid-link states | Complete the task "Add React verification, replacement-link, and invalid-link states" for US-001. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | sahil | 1.5 |  |
| Add Vitest unit tests and integration tests for registration and verification | Complete the task "Add Vitest unit tests and integration tests for registration and verification" for US-001. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Po-kai | 2 |  |

Table 1: US-001 (disaggregated tasks)

### Acceptance Tests

- [ ] US-001-T1: Visitor submits a valid name, email, and password → A PART account is created as Unverified and a verification email is sent
- [ ] US-001-T2: Visitor submits an invalid password or malformed email → Field-specific validation appears and no account is created
- [ ] US-001-T3: Visitor opens a valid verification link → The account becomes Verified and the user is directed to sign in
- [ ] US-001-T4: Visitor opens an expired, used, or changed verification link → Verification fails, no access is granted, and a replacement-link option is shown
- [ ] US-001-T5: Unverified user tries to create a team or accept an invitation → The action is blocked with a verification message
- [ ] US-001-T6: Visitor tries to register as an administrator → No ADMIN account is created

#### [US-002](../02_user_stories/user_stories.md#us-002)

**As a visitor or Participant, I want to register and sign in using my Google or GitHub account, so that I can access the platform quickly without creating separate credentials.**

| Task | Description | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|---:|
| Configure Firebase Google and GitHub OAuth providers | Complete the task "Configure Firebase Google and GitHub OAuth providers" for US-002. Implement the Node.js/Express API or Firebase Auth integration with server-side validation, authorization, and explicit failure responses. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Joel | 1.5 |  |
| Add React provider sign-in buttons and callback handling | Complete the task "Add React provider sign-in buttons and callback handling" for US-002. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Edgar | 2 |  |
| Create provider identity link records for PART accounts | Complete the task "Create provider identity link records for PART accounts" for US-002. Implement the Supabase PostgreSQL model or data operation with the required keys, constraints, indexes, and transaction behavior. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Mohmedjuber | 2 |  |
| Require verified provider email before provisioning a PART profile | Complete the task "Require verified provider email before provisioning a PART profile" for US-002. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Wei |  |  |
| Add reauthentication before linking a provider to an existing account | Complete the task "Add reauthentication before linking a provider to an existing account" for US-002. Implement the Node.js/Express API or Firebase Auth integration with server-side validation, authorization, and explicit failure responses. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | sahil | 1 |  |
| Route every provider sign-in into the email OTP flow | Complete the task "Route every provider sign-in into the email OTP flow" for US-002. Implement the Node.js/Express API or Firebase Auth integration with server-side validation, authorization, and explicit failure responses. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Po-kai | 1 |  |
| Add provider cancellation, failure, and unverified-email states | Complete the task "Add provider cancellation, failure, and unverified-email states" for US-002. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Joel | 1.5 |  |
| Add Vitest and integration tests for OAuth registration and linking | Complete the task "Add Vitest and integration tests for OAuth registration and linking" for US-002. Implement the Node.js/Express API or Firebase Auth integration with server-side validation, authorization, and explicit failure responses. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Edgar | 2 |  |

Table 3: US-002 (disaggregated tasks)

### Acceptance Tests

- [ ] US-002-T1: Visitor chooses Google or GitHub and approves access → A PART setup flow starts and the user is sent to email OTP
- [ ] US-002-T2: Visitor cancels or the provider returns an error → An actionable error appears and no session is created
- [ ] US-002-T3: User signs in with a provider account that has no verified email → The user is directed to email registration and no PART account is activated
- [ ] US-002-T4: Existing user links a provider after reauthentication and OTP → The provider is linked to the same PART account
- [ ] US-002-T5: User tries to link an account using only matching email text → The link is rejected until reauthentication and OTP succeed
- [ ] US-002-T6: User completes provider sign-in without email OTP → No full session or team action is available

#### [US-003](../02_user_stories/user_stories.md#us-003)

**As a Participant or Administrator, I want to sign in, maintain an authorized session, and sign out, so that I can safely use my authorized functions.**

| Task | Description | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|---:|
| Build Firebase email/password login form | Complete the task "Build Firebase email/password login form" for US-003. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Mohmedjuber | 2.5 |  |
| Add Firebase ID-token verification middleware in Express | Complete the task "Add Firebase ID-token verification middleware in Express" for US-003. Implement the Node.js/Express API or Firebase Auth integration with server-side validation, authorization, and explicit failure responses. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Wei |  |  |
| Enforce PART and ADMIN custom-claim authorization | Complete the task "Enforce PART and ADMIN custom-claim authorization" for US-003. Implement the Node.js/Express API or Firebase Auth integration with server-side validation, authorization, and explicit failure responses. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | sahil | 2 |  |
| Require the US-004 MFA claim before protected access | Complete the task "Require the US-004 MFA claim before protected access" for US-003. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Po-kai | 2 |  |
| Add token refresh, expiry, HTTPS, and cookie security configuration | Complete the task "Add token refresh, expiry, HTTPS, and cookie security configuration" for US-003. Implement the Node.js/Express API or Firebase Auth integration with server-side validation, authorization, and explicit failure responses. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Joel | 2 |  |
| Add logout with Firebase refresh-token revocation | Complete the task "Add logout with Firebase refresh-token revocation" for US-003. Implement the Node.js/Express API or Firebase Auth integration with server-side validation, authorization, and explicit failure responses. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Edgar | 2 |  |
| Add suspended-account checks and generic login errors | Complete the task "Add suspended-account checks and generic login errors" for US-003. Implement the Node.js/Express API or Firebase Auth integration with server-side validation, authorization, and explicit failure responses. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Mohmedjuber | 2 |  |
| Add Vitest middleware tests and login integration tests | Complete the task "Add Vitest middleware tests and login integration tests" for US-003. Implement the Node.js/Express API or Firebase Auth integration with server-side validation, authorization, and explicit failure responses. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Wei |  |  |

Table 5: US-003 (disaggregated tasks)

### Acceptance Tests

- [ ] US-003-T1: Valid PART or ADMIN enters primary credentials and completes MFA → The user receives an authorized session
- [ ] US-003-T2: User enters an incorrect password → A generic error and retry guidance appear without revealing account existence
- [ ] US-003-T3: User tries a protected action before MFA succeeds → The backend rejects the request and no protected page is available
- [ ] US-003-T4: Suspended user tries to sign in or renew a session → Sign-in is blocked
- [ ] US-003-T5: User signs out and reuses an old session → Protected requests fail because the session was revoked

#### [US-004](../02_user_stories/user_stories.md#us-004)

**As a Participant or Platform Administrator, I want to verify my identity via a one-time code sent to my email during login, so that a compromised password alone does not grant account access.**

| Task | Description | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|---:|
| Create PostgreSQL MFA challenge and attempt records | Complete the task "Create PostgreSQL MFA challenge and attempt records" for US-004. Implement the Supabase PostgreSQL model or data operation with the required keys, constraints, indexes, and transaction behavior. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | sahil | 1 |  |
| Generate and email cryptographically random six-digit OTPs | Complete the task "Generate and email cryptographically random six-digit OTPs" for US-004. Implement the Node.js/Express API or Firebase Auth integration with server-side validation, authorization, and explicit failure responses. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Po-kai | 2 |  |
| Add React OTP entry, resend, expiry, and error states | Complete the task "Add React OTP entry, resend, expiry, and error states" for US-004. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Joel | 2 |  |
| Validate and atomically consume the current OTP | Complete the task "Validate and atomically consume the current OTP" for US-004. Implement the Node.js/Express API or Firebase Auth integration with server-side validation, authorization, and explicit failure responses. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Edgar | 1.5 |  |
| Implement five-attempt counter and 15-minute account lock | Complete the task "Implement five-attempt counter and 15-minute account lock" for US-004. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Mohmedjuber | 1.5 |  |
| Invalidate predecessor challenges on resend and lock | Complete the task "Invalidate predecessor challenges on resend and lock" for US-004. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Wei |  |  |
| Add email delivery failure and retry handling | Complete the task "Add email delivery failure and retry handling" for US-004. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | sahil | 1.5 |  |
| Add Vitest and integration tests for OTP lifecycle and locking | Complete the task "Add Vitest and integration tests for OTP lifecycle and locking" for US-004. Implement the Node.js/Express API or Firebase Auth integration with server-side validation, authorization, and explicit failure responses. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Po-kai | 2 |  |

Table 7: US-004 (disaggregated tasks)

### Acceptance Tests

- [ ] US-004-T1: User enters the current six-digit code from the email → Login completes and the protected session starts
- [ ] US-004-T2: User enters an incorrect, expired, or already-used code → Login fails and the code cannot be reused
- [ ] US-004-T3: User enters five incorrect codes → The account is locked for 15 minutes and outstanding codes stop working
- [ ] US-004-T4: User requests a replacement code → The previous code stops working and the new code is sent without resetting failures
- [ ] US-004-T5: User tries OAuth or password recovery without email OTP → The user is still required to complete email OTP
- [ ] US-004-T6: User tries a code after lock expiry without fresh primary authentication → Login does not continue until primary authentication and a fresh OTP are completed

#### [US-005](../02_user_stories/user_stories.md#us-005)

**As a user, I want to request a secure password reset link via my registered email, so that I can regain access if I forget my password.**

| Task | Description | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|---:|
| Add password-recovery request page with generic confirmation | Complete the task "Add password-recovery request page with generic confirmation" for US-005. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Joel | 1.5 |  |
| Connect Firebase password-reset email service | Complete the task "Connect Firebase password-reset email service" for US-005. Implement the Node.js/Express API or Firebase Auth integration with server-side validation, authorization, and explicit failure responses. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Edgar | 1 |  |
| Add reset-link validation and password-policy form | Complete the task "Add reset-link validation and password-policy form" for US-005. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Mohmedjuber | 1.5 |  |
| Revoke Firebase refresh tokens after a successful reset | Complete the task "Revoke Firebase refresh tokens after a successful reset" for US-005. Implement the Node.js/Express API or Firebase Auth integration with server-side validation, authorization, and explicit failure responses. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Wei |  |  |
| Route the next login through MFA without auto-login | Complete the task "Route the next login through MFA without auto-login" for US-005. Implement the Node.js/Express API or Firebase Auth integration with server-side validation, authorization, and explicit failure responses. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | sahil | 0.5 |  |
| Add expired, invalid, used-link, and OAuth recovery states | Complete the task "Add expired, invalid, used-link, and OAuth recovery states" for US-005. Implement the Node.js/Express API or Firebase Auth integration with server-side validation, authorization, and explicit failure responses. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Po-kai | 1.5 |  |
| Add Vitest and integration tests for password recovery | Complete the task "Add Vitest and integration tests for password recovery" for US-005. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Joel | 1.5 |  |

Table 9: US-005 (disaggregated tasks)

### Acceptance Tests

- [ ] US-005-T1: User submits an email on the password-recovery page → The same generic confirmation appears for known and unknown addresses
- [ ] US-005-T2: User opens a valid reset link and submits a compliant password → The password changes and the link is consumed
- [ ] US-005-T3: User opens an expired, invalid, or used reset link → The password is unchanged and an error appears
- [ ] US-005-T4: User signs in after resetting the password → All old sessions are revoked and email MFA is required
- [ ] US-005-T5: OAuth-only user requests recovery → The user receives the provider recovery path without account-type disclosure

#### [US-006](../02_user_stories/user_stories.md#us-006)

**As a Participant, I want to maintain my technical profile with my role, skill tags, academic institution, and portfolio links, so that prospective teammates can assess my capabilities.**

| Task | Description | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|---:|
| Create Supabase PostgreSQL participant profile, skill, and portfolio tables | Complete the task "Create Supabase PostgreSQL participant profile, skill, and portfolio tables" for US-006. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Edgar | 1 |  |
| Create Express profile read and update endpoints | Complete the task "Create Express profile read and update endpoints" for US-006. Implement the Node.js/Express API or Firebase Auth integration with server-side validation, authorization, and explicit failure responses. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Mohmedjuber | 1 |  |
| Add validation for roles, skills, institution, and HTTPS portfolio URLs | Complete the task "Add validation for roles, skills, institution, and HTTPS portfolio URLs" for US-006. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Wei |  |  |
| Build React profile edit and candidate-card components | Complete the task "Build React profile edit and candidate-card components" for US-006. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | sahil | 2 |  |
| Apply profile privacy rules for visitors, PART users, and confirmed teammates | Complete the task "Apply profile privacy rules for visitors, PART users, and confirmed teammates" for US-006. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Po-kai | 1 |  |
| Show self-declared portfolio labels and field-specific errors | Complete the task "Show self-declared portfolio labels and field-specific errors" for US-006. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Joel | 1 |  |
| Revoke shared contact visibility after team removal | Complete the task "Revoke shared contact visibility after team removal" for US-006. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Edgar | 1.5 |  |
| Add Vitest and integration tests for profile permissions and validation | Complete the task "Add Vitest and integration tests for profile permissions and validation" for US-006. Implement the Node.js/Express API or Firebase Auth integration with server-side validation, authorization, and explicit failure responses. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Mohmedjuber | 1 |  |

Table 11: US-006 (disaggregated tasks)

### Acceptance Tests

- [ ] US-006-T1: Participant edits their role, skills, institution, and HTTPS portfolio link → The valid changes persist and appear in candidate views
- [ ] US-006-T2: Participant enters a non-HTTPS or malformed portfolio URL → A field-specific error appears and other entered values remain
- [ ] US-006-T3: Visitor opens a participant card → Private participant details are not shown
- [ ] US-006-T4: Authenticated PART views a permitted candidate card → Permitted profile fields and self-declared links are visible
- [ ] US-006-T5: Confirmed teammate views a shared contact handle, then leaves the team → The handle is visible while confirmed and access is revoked after removal
- [ ] US-006-T6: Participant tries to edit another user's profile → The update is denied

#### [US-007](../02_user_stories/user_stories.md#us-007)

**As a Participant, I want to record past hackathons and project links, so that Team Leads can review my self-declared experience.**

| Task | Description | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|---:|
| Create PostgreSQL hackathon-history records for participant profiles | Complete the task "Create PostgreSQL hackathon-history records for participant profiles" for US-007. Implement the Supabase PostgreSQL model or data operation with the required keys, constraints, indexes, and transaction behavior. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Wei |  |  |
| Add Express history create, edit, list, and delete endpoints | Complete the task "Add Express history create, edit, list, and delete endpoints" for US-007. Implement the Node.js/Express API or Firebase Auth integration with server-side validation, authorization, and explicit failure responses. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | sahil | 2 |  |
| Validate event name, date, role, project title, and HTTPS URL | Complete the task "Validate event name, date, role, project title, and HTTPS URL" for US-007. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Po-kai | 1 |  |
| Compute Beginner, Competitor, and Veteran badges | Complete the task "Compute Beginner, Competitor, and Veteran badges" for US-007. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Joel | 1.5 |  |
| Build React history editor and profile display | Complete the task "Build React history editor and profile display" for US-007. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Edgar | 2 |  |
| Apply authenticated viewing and owner-only edit permissions | Complete the task "Apply authenticated viewing and owner-only edit permissions" for US-007. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Mohmedjuber | 1.5 |  |
| Add Vitest and integration tests for history and badge recalculation | Complete the task "Add Vitest and integration tests for history and badge recalculation" for US-007. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Wei |  |  |

Table 13: US-007 (disaggregated tasks)

### Acceptance Tests

- [ ] US-007-T1: Participant adds a valid past hackathon and project link → The record is saved and the self-reported badge is recalculated
- [ ] US-007-T2: Participant enters an invalid project URL or date → The record is rejected with a clear validation error
- [ ] US-007-T3: Participant adds a fourth history record → The badge changes to Veteran and the count is shown
- [ ] US-007-T4: Participant edits or removes a history record → The record changes and the badge recalculates
- [ ] US-007-T5: Visitor tries to view participant history → History and project links are not shown
- [ ] US-007-T6: Authenticated PART views another permitted profile → The permitted self-reported history and links are visible

#### [US-029](../02_user_stories/user_stories.md#us-029)

**As a Participant or Platform Administrator, I want to link a standard authenticator app (such as Google Authenticator or Microsoft Authenticator) to my account, so that I can generate instant 6-digit verification codes on my mobile device without waiting for email delivery.**

| Task | Description | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|---:|
| Define the approved future authenticator enrollment and fallback design | Complete the task "Define the approved future authenticator enrollment and fallback design" for US-029. Implement the Node.js/Express API or Firebase Auth integration with server-side validation, authorization, and explicit failure responses. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | sahil | 1.5 |  |
| Add protected TOTP secret enrollment storage | Complete the task "Add protected TOTP secret enrollment storage" for US-029. Implement the Supabase PostgreSQL model or data operation with the required keys, constraints, indexes, and transaction behavior. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Po-kai | 1 |  |
| Build QR enrollment and confirmation-code screens | Complete the task "Build QR enrollment and confirmation-code screens" for US-029. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Joel | 2 |  |
| Add reauthentication and recovery-code controls | Complete the task "Add reauthentication and recovery-code controls" for US-029. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Edgar | 1.5 |  |
| Protect secrets from logs and other accounts | Complete the task "Protect secrets from logs and other accounts" for US-029. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Mohmedjuber | 2 |  |
| Preserve email OTP and the five-attempt/15-minute lock policy | Complete the task "Preserve email OTP and the five-attempt/15-minute lock policy" for US-029. Implement the Node.js/Express API or Firebase Auth integration with server-side validation, authorization, and explicit failure responses. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Wei |  |  |
| Add Vitest and integration tests for setup failure and activation | Complete the task "Add Vitest and integration tests for setup failure and activation" for US-029. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | sahil | 3 |  |

Table 15: US-029 (disaggregated tasks)

### Acceptance Tests

- [ ] US-029-T1: Authenticated PART or ADMIN starts enrollment and confirms a valid authenticator code → The authenticator method becomes active
- [ ] US-029-T2: User enters an incorrect setup code → Enrollment fails and the method is not activated
- [ ] US-029-T3: User tries to view another account's enrollment secret → Access is denied
- [ ] US-029-T4: User uses a recovery code → The code works once and cannot be reused
- [ ] US-029-T5: User signs in before authenticator enrollment is approved → Email OTP remains the required login method
- [ ] US-029-T6: User enters five incorrect authenticator codes → The account-wide 15-minute lock policy is applied

#### [US-008](../02_user_stories/user_stories.md#us-008) — ~~OUT OF SCOPE (hackathon listing)~~

> **Deferred:** ~~US-008 / FR-018–FR-020~~ are out of scope for the current app. Active Must-Have replacement: **[US-030](#us-030)** chat (FR-086–FR-089). Tasks below are retained for history only — **do not schedule in the 3-day chat slice**.

~~**As a visitor or Participant, I want to browse and filter upcoming hackathons, so that I can identify events I want to attend and inspect available teams.**~~

| Task | Description | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|---:|
| Create PostgreSQL verified hackathon event model and indexes | Complete the task "Create PostgreSQL verified hackathon event model and indexes" for US-008. Implement the Supabase PostgreSQL model or data operation with the required keys, constraints, indexes, and transaction behavior. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Po-kai | 2 |  |
| Create public Express event list and detail endpoints | Complete the task "Create public Express event list and detail endpoints" for US-008. Implement the Node.js/Express API or Firebase Auth integration with server-side validation, authorization, and explicit failure responses. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Joel | 1.5 |  |
| Add keyword, format, and time-state filters | Complete the task "Add keyword, format, and time-state filters" for US-008. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Edgar | 2 |  |
| Build React event directory, filter controls, and empty state | Complete the task "Build React event directory, filter controls, and empty state" for US-008. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Mohmedjuber | 1.5 |  |
| Show verified event metadata and safe official links | Complete the task "Show verified event metadata and safe official links" for US-008. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Wei |  |  |
| Hide pending/rejected events and disable unsafe links | Complete the task "Hide pending/rejected events and disable unsafe links" for US-008. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | sahil | 2 |  |
| Connect event details to the team vacancy board | Complete the task "Connect event details to the team vacancy board" for US-008. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Po-kai | 1.5 |  |
| Add Vitest and integration tests for filters and visibility | Complete the task "Add Vitest and integration tests for filters and visibility" for US-008. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Joel | 1.5 |  |

Table 17: US-008 (disaggregated tasks)

### Acceptance Tests

- [ ] US-008-T1: Visitor browses the event directory → Verified events show title, dates, format, location, limits, and official URL
- [ ] US-008-T2: User combines keyword, format, and time-state filters → Only events matching all selected filters are shown
- [ ] US-008-T3: User searches with filters that match nothing → A clear empty state and filter-reset option appear
- [ ] US-008-T4: Visitor opens an event's team board → An anonymized team preview is shown
- [ ] US-008-T5: User opens an ADMIN-disabled official link → The link cannot be followed from the listing
- [ ] US-008-T6: User opens a concluded event → The event and board are read-only

#### [US-009](../02_user_stories/user_stories.md#us-009) — ~~OUT OF SCOPE (hackathon listing)~~

> **Deferred:** ~~US-009 / FR-021–FR-022~~ out of scope. See **US-030** for active Must-Have work.

~~**As a Participant, I want to submit an unlisted hackathon for verification, so that users can form teams around one trusted event record.**~~

| Task | Description | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|---:|
| Create PostgreSQL pending event-submission model and status fields | Complete the task "Create PostgreSQL pending event-submission model and status fields" for US-009. Implement the Supabase PostgreSQL model or data operation with the required keys, constraints, indexes, and transaction behavior. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Edgar | 3 |  |
| Build React event submission form with official event fields | Complete the task "Build React event submission form with official event fields" for US-009. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Mohmedjuber | 1.5 |  |
| Add server-side HTTPS, date, format, location, and team-limit validation | Complete the task "Add server-side HTTPS, date, format, location, and team-limit validation" for US-009. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Wei | 2 |  |
| Add normalized URL and edition/start-date duplicate checks | Complete the task "Add normalized URL and edition/start-date duplicate checks" for US-009. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | sahil | 2 |  |
| Show similar candidate events without automatic merging | Complete the task "Show similar candidate events without automatic merging" for US-009. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Po-kai | 1.5 |  |
| Create Express submitter status and resubmission endpoints | Complete the task "Create Express submitter status and resubmission endpoints" for US-009. Implement the Node.js/Express API or Firebase Auth integration with server-side validation, authorization, and explicit failure responses. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Joel | 2 |  |
| Block recruitment until ADMIN approval and show feedback | Complete the task "Block recruitment until ADMIN approval and show feedback" for US-009. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Edgar | 2 |  |
| Add Vitest and integration tests for duplicate and status workflows | Complete the task "Add Vitest and integration tests for duplicate and status workflows" for US-009. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Mohmedjuber | 2 |  |

Table 19: US-009 (disaggregated tasks)

### Acceptance Tests

- [ ] US-009-T1: Verified PART submits a complete new event → The event is Pending Verification and visible to the submitter and ADMIN
- [ ] US-009-T2: Submitter enters an invalid URL or end date before the start date → The form shows validation errors and does not submit
- [ ] US-009-T3: Submitter sends an event matching an existing normalized URL and edition → Similar/canonical candidates are shown and a duplicate pending record is not created
- [ ] US-009-T4: Submitter opens a pending event's team board → Team formation, availability, invitations, and applications are blocked
- [ ] US-009-T5: ADMIN rejects a submission with feedback and the submitter resubmits a correction → The status and feedback update and the corrected submission returns for review
- [ ] US-009-T6: Unverified or unauthenticated visitor tries to submit an event → The submission is denied

#### [US-010](../02_user_stories/user_stories.md#us-010) — ~~OUT OF SCOPE (hackathon listing)~~

> **Deferred:** ~~US-010 / FR-023–FR-028~~ out of scope. See **US-030** for active Must-Have work.

~~**As a Platform Administrator, I want to review, correct, and verify crowdsourced hackathon submissions and manage published listings, so that the platform maintains an accurate single source of truth.**~~

| Task | Description | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|---:|
| Create ADMIN event-verification queue and detail endpoints | Complete the task "Create ADMIN event-verification queue and detail endpoints" for US-010. Implement the Node.js/Express API or Firebase Auth integration with server-side validation, authorization, and explicit failure responses. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Wei | 3 |  |
| Add RBAC middleware for ADMIN event operations | Complete the task "Add RBAC middleware for ADMIN event operations" for US-010. Implement the Node.js/Express API or Firebase Auth integration with server-side validation, authorization, and explicit failure responses. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | sahil | 2 |  |
| Build organizer-source, dates, URL, and team-limit review form | Complete the task "Build organizer-source, dates, URL, and team-limit review form" for US-010. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Po-kai | 2 |  |
| Implement approve, reject, correct, merge, and archive services | Complete the task "Implement approve, reject, correct, merge, and archive services" for US-010. Implement the Node.js/Express API or Firebase Auth integration with server-side validation, authorization, and explicit failure responses. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Joel | 2 |  |
| Create append-only event action records with actor, reason, outcome, and time | Complete the task "Create append-only event action records with actor, reason, outcome, and time" for US-010. Implement the Supabase PostgreSQL model or data operation with the required keys, constraints, indexes, and transaction behavior. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Edgar | 3 |  |
| Add transactional duplicate merge and invariant-conflict checks | Complete the task "Add transactional duplicate merge and invariant-conflict checks" for US-010. Implement the Node.js/Express API or Firebase Auth integration with server-side validation, authorization, and explicit failure responses. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Mohmedjuber | 2.5 |  |
| Disable unsafe links and recruitment while preserving memberships | Complete the task "Disable unsafe links and recruitment while preserving memberships" for US-010. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Wei | 2 |  |
| Build React queue, feedback, status, and affected-team views | Complete the task "Build React queue, feedback, status, and affected-team views" for US-010. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | sahil | 2.5 |  |
| Add Vitest and integration tests for ADMIN lifecycle operations | Complete the task "Add Vitest and integration tests for ADMIN lifecycle operations" for US-010. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Po-kai | 1 |  |

Table 21: US-010 (disaggregated tasks)

### Acceptance Tests

- [ ] US-010-T1: ADMIN reviews a complete submission and approves it → A Verified public event is created and recruitment is enabled
- [ ] US-010-T2: ADMIN reviews a submission with missing or inconsistent official rules → The event remains pending with actionable feedback
- [ ] US-010-T3: ADMIN merges two duplicate events with compatible memberships → One canonical record remains and memberships, capacities, and vacancies are preserved
- [ ] US-010-T4: ADMIN attempts a merge with conflicting team invariants → The merge is rejected without partial changes and conflicts are identified
- [ ] US-010-T5: ADMIN disables an unsafe published event → The link and recruitment stop while historical memberships remain
- [ ] US-010-T6: PART tries to inspect the queue or change a private roster through ADMIN controls → Access is denied

#### [US-011](../02_user_stories/user_stories.md#us-011)

**As a Participant, I want to declare my availability for a specific hackathon and state my desired role and commitment level, so that Team Leads can discover me as an available candidate.**

| Task | Description | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|---:|
| Create PostgreSQL event availability model scoped to participant and event | Complete the task "Create PostgreSQL event availability model scoped to participant and event" for US-011. Implement the Supabase PostgreSQL model or data operation with the required keys, constraints, indexes, and transaction behavior. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Joel | 3 |  |
| Build Express availability read and toggle endpoints | Complete the task "Build Express availability read and toggle endpoints" for US-011. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Edgar | 1.5 |  |
| Validate desired role, non-negative commitment hours, and goal labels | Complete the task "Validate desired role, non-negative commitment hours, and goal labels" for US-011. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Mohmedjuber | 2 |  |
| Build React availability form and status display | Complete the task "Build React availability form and status display" for US-011. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Wei | 2 |  |
| Restrict availability to verified PART users on Verified recruiting events | Complete the task "Restrict availability to verified PART users on Verified recruiting events" for US-011. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | sahil | 1 |  |
| Clear availability atomically on confirmed team membership | Complete the task "Clear availability atomically on confirmed team membership" for US-011. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Po-kai | 1.5 |  |
| Add candidate visibility and empty-state handling | Complete the task "Add candidate visibility and empty-state handling" for US-011. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Joel | 2 |  |
| Add Vitest and integration tests for availability lifecycle | Complete the task "Add Vitest and integration tests for availability lifecycle" for US-011. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Edgar | 2 |  |

Table 23: US-011 (disaggregated tasks)

### Acceptance Tests

- [ ] US-011-T1: Verified PART selects an event, role, hours, goal, and Looking for Team → The event-specific availability is saved and visible to eligible leads
- [ ] US-011-T2: Participant enters negative hours or an unsupported goal → The form rejects the value with a validation message
- [ ] US-011-T3: Visitor or unverified PART tries to declare availability → The action is blocked
- [ ] US-011-T4: Participant creates or joins a team for the event → Availability is cleared and cannot be re-enabled while membership is confirmed
- [ ] US-011-T5: Participant joins a team for one event while available for another → Only the first event's availability is cleared

#### [US-012](../02_user_stories/user_stories.md#us-012)

**As a Team Lead, I want to create a structured recruitment listing with discrete skill vacancy slots and edit it as our needs evolve, so that I can attract targeted teammates.**

| Task | Description | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|---:|
| Create PostgreSQL team, membership, vacancy, and recruitment-status models | Complete the task "Create PostgreSQL team, membership, vacancy, and recruitment-status models" for US-012. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Mohmedjuber | 3 |  |
| Build atomic team-creation service that confirms the owner | Complete the task "Build atomic team-creation service that confirms the owner" for US-012. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Wei | 2 |  |
| Create Express team listing and vacancy CRUD endpoints | Complete the task "Create Express team listing and vacancy CRUD endpoints" for US-012. Implement the Node.js/Express API or Firebase Auth integration with server-side validation, authorization, and explicit failure responses. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | sahil | 3 |  |
| Add validation for pitch length, goals, hours, links, slots, and event limits | Complete the task "Add validation for pitch length, goals, hours, links, slots, and event limits" for US-012. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Po-kai | 1 |  |
| Protect team operations with LEAD ownership checks | Complete the task "Protect team operations with LEAD ownership checks" for US-012. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Joel | 1.5 |  |
| Cancel pending requests when slots are removed or teams disband | Complete the task "Cancel pending requests when slots are removed or teams disband" for US-012. Implement the Node.js/Express API or Firebase Auth integration with server-side validation, authorization, and explicit failure responses. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Edgar | 1 |  |
| Implement member removal, availability restore, and lifecycle lock checks | Complete the task "Implement member removal, availability restore, and lifecycle lock checks" for US-012. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Mohmedjuber | 1.5 |  |
| Build React team listing editor, roster, vacancy, and error states | Complete the task "Build React team listing editor, roster, vacancy, and error states" for US-012. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Wei | 2 |  |
| Add Vitest and integration tests for team lifecycle and concurrency rules | Complete the task "Add Vitest and integration tests for team lifecycle and concurrency rules" for US-012. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | sahil | 2 |  |

Table 25: US-012 (disaggregated tasks)

### Acceptance Tests

- [ ] US-012-T1: Verified PART creates a listing for a recruiting event → The user becomes the first confirmed member and the listing is published
- [ ] US-012-T2: Team Lead enters a pitch over 500 characters or an unsafe link → The invalid field is rejected
- [ ] US-012-T3: Team Lead adds vacancies within the official event maximum → Open slots and required skills appear on the team card
- [ ] US-012-T4: Team Lead removes a vacancy with pending requests → Those requests are cancelled with alerts and confirmed members remain
- [ ] US-012-T5: Team Lead removes a non-owner member before lock → The member is removed with a reason, capacity reopens, and availability may return
- [ ] US-012-T6: Non-owner or user of a locked, archived, disabled, or disbanded team tries to change it → The request is denied

#### [US-013](../02_user_stories/user_stories.md#us-013)

**As a Participant, I want to browse and filter open team vacancy slots for a hackathon, so that I can identify teams matching my technical stack and project goals.**

| Task | Description | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|---:|
| Create Express vacancy-board list endpoint with active-team filters | Complete the task "Create Express vacancy-board list endpoint with active-team filters" for US-013. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Po-kai | 2 |  |
| Add skill, role, goal, and slot-count query handling | Complete the task "Add skill, role, goal, and slot-count query handling" for US-013. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Joel | 2 |  |
| Build React vacancy board and filter controls | Complete the task "Build React vacancy board and filter controls" for US-013. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Edgar | 1.5 |  |
| Show full PART details and anonymized visitor previews | Complete the task "Show full PART details and anonymized visitor previews" for US-013. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Mohmedjuber | 2 |  |
| Add no-results state with filter reset | Complete the task "Add no-results state with filter reset" for US-013. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Wei | 2 |  |
| Link Apply actions to the US-018 application flow | Complete the task "Link Apply actions to the US-018 application flow" for US-013. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | sahil | 1.5 |  |
| Add Vitest and integration tests for visibility and filters | Complete the task "Add Vitest and integration tests for visibility and filters" for US-013. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Po-kai | 2 |  |

Table 27: US-013 (disaggregated tasks)

### Acceptance Tests

- [ ] US-013-T1: PART opens a Verified event's team board → Active unlocked teams with open slots are displayed
- [ ] US-013-T2: PART combines skill, role, goal, and slot-count filters → Only matching vacancy slots are shown
- [ ] US-013-T3: Visitor opens the board → Anonymized previews and sign-in prompts are shown
- [ ] US-013-T4: User applies filters with no matching teams → A clear empty state and reset option appear
- [ ] US-013-T5: User clicks Apply on a vacancy → The US-018 application form opens
- [ ] US-013-T6: User opens a hidden or disbanded team → The team is excluded from the board

#### [US-014](../02_user_stories/user_stories.md#us-014)

**As a Team Lead, I want to search and filter the event candidate pool using specific skill combinations and experience tiers, so that I can manually discover candidates who fit our vacancy needs.**

| Task | Description | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|---:|
| Create candidate-directory query service for active team owners | Complete the task "Create candidate-directory query service for active team owners" for US-014. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Joel | 1.5 |  |
| Add AND/OR skills, role, hours, badge, and availability filters | Complete the task "Add AND/OR skills, role, hours, badge, and availability filters" for US-014. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Edgar | 2 |  |
| Exclude all confirmed event participants from results | Complete the task "Exclude all confirmed event participants from results" for US-014. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Mohmedjuber | 1.5 |  |
| Build React candidate directory and filter controls | Complete the task "Build React candidate directory and filter controls" for US-014. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Wei | 2 |  |
| Apply US-006 privacy fields and link profile inspection | Complete the task "Apply US-006 privacy fields and link profile inspection" for US-014. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | sahil | 2 |  |
| Connect candidate cards to US-017 invitations | Complete the task "Connect candidate cards to US-017 invitations" for US-014. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Po-kai | 2 |  |
| Add Vitest and integration tests for LEAD access and filters | Complete the task "Add Vitest and integration tests for LEAD access and filters" for US-014. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Joel | 2 |  |

Table 29: US-014 (disaggregated tasks)

### Acceptance Tests

- [ ] US-014-T1: Active Team Lead opens the candidate directory → Eligible candidates for the event are shown
- [ ] US-014-T2: Team Lead combines AND/OR skills, role, hours, and experience filters → Results match the selected filter logic
- [ ] US-014-T3: Team Lead views a candidate card → Only permitted handle, role, self-reported history/badge, and skills appear
- [ ] US-014-T4: Team Lead clicks Invite on an eligible candidate → The US-017 invitation flow opens
- [ ] US-014-T5: Confirmed participant or unrelated PART tries to use the directory → Access is denied or the participant is excluded

#### [US-015](../02_user_stories/user_stories.md#us-015)

**As a Team Lead, I want to view a ranked list of compatible candidates for my team's open vacancy slots, so that I can invite teammates with complementary skills and matching commitments.**

| Task | Description | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|---:|
| Define deterministic FR-043–045 scoring rules and missing-input handling | Complete the task "Define deterministic FR-043–045 scoring rules and missing-input handling" for US-015. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Edgar | 3 |  |
| Create recommendation service for an owner and open slot | Complete the task "Create recommendation service for an owner and open slot" for US-015. Implement the Node.js/Express API or Firebase Auth integration with server-side validation, authorization, and explicit failure responses. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Mohmedjuber | 2.5 |  |
| Exclude inactive, unavailable, and confirmed event participants | Complete the task "Exclude inactive, unavailable, and confirmed event participants" for US-015. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Wei | 3 |  |
| Implement bounded 0–100 scores and tie-breaking | Complete the task "Implement bounded 0–100 scores and tie-breaking" for US-015. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | sahil | 2 |  |
| Return explainable score contributions without internal identifiers | Complete the task "Return explainable score contributions without internal identifiers" for US-015. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Po-kai | 2 |  |
| Build React recommendation list, empty state, and fallback state | Complete the task "Build React recommendation list, empty state, and fallback state" for US-015. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Joel | 2 |  |
| Connect eligible candidates to US-017 invitation flow | Complete the task "Connect eligible candidates to US-017 invitation flow" for US-015. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Edgar | 2 |  |
| Add Vitest and integration tests for scoring, permissions, and exclusions | Complete the task "Add Vitest and integration tests for scoring, permissions, and exclusions" for US-015. Implement the Node.js/Express API or Firebase Auth integration with server-side validation, authorization, and explicit failure responses. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Mohmedjuber | 2.5 |  |

Table 31: US-015 (disaggregated tasks)

### Acceptance Tests

- [ ] US-015-T1: Team Lead requests recommendations for an open slot → Candidates appear in deterministic ranked order with scores
- [ ] US-015-T2: Team Lead opens a recommendation → Skill, role, goal, and hours contributions are explained
- [ ] US-015-T3: A candidate is not Looking for Team or is already confirmed → The candidate is excluded
- [ ] US-015-T4: No eligible candidates exist → A no-results message appears
- [ ] US-015-T5: Scoring fails for the request → An eligible unranked candidate list is shown
- [ ] US-015-T6: Non-owner or user with no open slot requests recommendations → The request is denied

#### [US-016](../02_user_stories/user_stories.md#us-016)

**As a Participant, I want to receive proactive recommendations of open teams matching my profile, so that I can discover compatible projects without manual filtering.**

| Task | Description | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|---:|
| Define reverse matching inputs and team eligibility rules | Complete the task "Define reverse matching inputs and team eligibility rules" for US-016. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Wei | 2 |  |
| Create recommendation query for a selected event and PART profile | Complete the task "Create recommendation query for a selected event and PART profile" for US-016. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | sahil | 2.5 |  |
| Calculate match percentage and matched skill tags | Complete the task "Calculate match percentage and matched skill tags" for US-016. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Po-kai | 2 |  |
| Build React recommended-teams page and empty state | Complete the task "Build React recommended-teams page and empty state" for US-016. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Joel | 1 |  |
| Connect suggestions to the US-018 application form | Complete the task "Connect suggestions to the US-018 application form" for US-016. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Edgar | 1 |  |
| Add permission checks for the participant's own profile | Complete the task "Add permission checks for the participant's own profile" for US-016. Implement the Node.js/Express API or Firebase Auth integration with server-side validation, authorization, and explicit failure responses. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Mohmedjuber | 1 |  |
| Add Vitest and integration tests for recommendations | Complete the task "Add Vitest and integration tests for recommendations" for US-016. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Wei | 2 |  |

Table 33: US-016 (disaggregated tasks)

### Acceptance Tests

- [ ] US-016-T1: PART selects a hackathon and opens recommendations → Open compatible teams are shown in ranked order
- [ ] US-016-T2: PART opens a recommended team → A match percentage and matched skill tags are displayed
- [ ] US-016-T3: PART clicks Apply on a recommendation → The US-018 application form opens for that team
- [ ] US-016-T4: PART has no matching teams → A clear empty state appears
- [ ] US-016-T5: Visitor or another user tries to access a participant's recommendations → Access is denied

#### [US-017](../02_user_stories/user_stories.md#us-017)

**As a Team Lead, I want to issue a direct invitation to an available candidate, so that they can review my team and decide whether to join.**

| Task | Description | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|---:|
| Create PostgreSQL invitation model with pending, expiry, and status fields | Complete the task "Create PostgreSQL invitation model with pending, expiry, and status fields" for US-017. Implement the Supabase PostgreSQL model or data operation with the required keys, constraints, indexes, and transaction behavior. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | sahil | 3 |  |
| Build owner-only Express invitation endpoint | Complete the task "Build owner-only Express invitation endpoint" for US-017. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Po-kai | 1 |  |
| Validate candidate availability, team state, event, and open slot | Complete the task "Validate candidate availability, team state, event, and open slot" for US-017. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Joel | 2 |  |
| Enforce one pending invitation per slot and invitee/team | Complete the task "Enforce one pending invitation per slot and invitee/team" for US-017. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Edgar | 1.5 |  |
| Implement 48-hour expiry and acceptance-time revalidation | Complete the task "Implement 48-hour expiry and acceptance-time revalidation" for US-017. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Mohmedjuber | 2 |  |
| Add invitation cancel endpoint and basic status alerts | Complete the task "Add invitation cancel endpoint and basic status alerts" for US-017. Implement the Node.js/Express API or Firebase Auth integration with server-side validation, authorization, and explicit failure responses. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Wei | 2 |  |
| Build React invite form and invitation view | Complete the task "Build React invite form and invitation view" for US-017. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | sahil | 3 |  |
| Add Vitest and integration tests for invitations and permissions | Complete the task "Add Vitest and integration tests for invitations and permissions" for US-017. Implement the Node.js/Express API or Firebase Auth integration with server-side validation, authorization, and explicit failure responses. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Po-kai | 2 |  |

Table 35: US-017 (disaggregated tasks)

### Acceptance Tests

- [ ] US-017-T1: Team Lead invites an available PART to an open slot → A Pending invitation is created with a 48-hour expiry
- [ ] US-017-T2: Team Lead invites a candidate who already has a pending invite for that slot → The duplicate invitation is rejected
- [ ] US-017-T3: Invited PART opens an expired invitation → Acceptance is rejected and the invitation is shown as expired
- [ ] US-017-T4: Team Lead cancels a pending invitation → Both users see the updated invitation status
- [ ] US-017-T5: Non-owner or user of a locked team tries to invite → The action is denied
- [ ] US-017-T6: The slot closes before the candidate accepts → The invitation becomes unusable

#### [US-018](../02_user_stories/user_stories.md#us-018)

**As a Participant, I want to submit an application to an open team vacancy slot, so that the Team Lead can review my profile and consider me for membership.**

| Task | Description | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|---:|
| Create PostgreSQL application model with status and slot relation | Complete the task "Create PostgreSQL application model with status and slot relation" for US-018. Implement the Supabase PostgreSQL model or data operation with the required keys, constraints, indexes, and transaction behavior. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Joel | 2.5 |  |
| Build React application form with optional 250-character message | Complete the task "Build React application form with optional 250-character message" for US-018. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Edgar | 2 |  |
| Create Express application endpoint with atomic count validation | Complete the task "Create Express application endpoint with atomic count validation" for US-018. Implement the Node.js/Express API or Firebase Auth integration with server-side validation, authorization, and explicit failure responses. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Mohmedjuber | 2.5 |  |
| Enforce verified PART, active unlocked team, open slot, and one-team rules | Complete the task "Enforce verified PART, active unlocked team, open slot, and one-team rules" for US-018. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Wei | 2 |  |
| Enforce three pending applications per PART per event | Complete the task "Enforce three pending applications per PART per event" for US-018. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | sahil | 1.5 |  |
| Add applicant status, withdrawal, and owner alert handling | Complete the task "Add applicant status, withdrawal, and owner alert handling" for US-018. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Po-kai | 2 |  |
| Add duplicate pending-application and rate-limit errors | Complete the task "Add duplicate pending-application and rate-limit errors" for US-018. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Joel | 2 |  |
| Add Vitest and integration tests for application limits and permissions | Complete the task "Add Vitest and integration tests for application limits and permissions" for US-018. Implement the Node.js/Express API or Firebase Auth integration with server-side validation, authorization, and explicit failure responses. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Edgar | 3.5 |  |

Table 37: US-018 (disaggregated tasks)

### Acceptance Tests

- [ ] US-018-T1: Verified PART submits an application with a valid message → A Pending Review application is created and the owner is alerted
- [ ] US-018-T2: Applicant enters a message longer than 250 characters → The application is rejected with a length error
- [ ] US-018-T3: Applicant submits a second application to the same team → The duplicate pending application is rejected
- [ ] US-018-T4: Applicant reaches three pending applications in one event → A fourth application is blocked while applications for other events remain separate
- [ ] US-018-T5: Applicant withdraws before a decision → The application becomes withdrawn
- [ ] US-018-T6: Visitor, unverified PART, or confirmed event member applies → The application is denied

#### [US-019](../02_user_stories/user_stories.md#us-019)

**As an invited Participant, I want to accept or decline a team invitation, so that I can confirm my team placement or keep looking.**

| Task | Description | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|---:|
| Build invitation detail and response endpoints for the addressed PART | Complete the task "Build invitation detail and response endpoints for the addressed PART" for US-019. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Mohmedjuber | 3 |  |
| Implement atomic acceptance revalidation and membership creation | Complete the task "Implement atomic acceptance revalidation and membership creation" for US-019. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Wei | 2 |  |
| Cancel competing invitations, applications, and filled-slot requests | Complete the task "Cancel competing invitations, applications, and filled-slot requests" for US-019. Implement the Node.js/Express API or Firebase Auth integration with server-side validation, authorization, and explicit failure responses. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | sahil | 2 |  |
| Implement decline and owner alert behavior | Complete the task "Implement decline and owner alert behavior" for US-019. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Po-kai | 2 |  |
| Implement pre-lock member leave and availability restoration | Complete the task "Implement pre-lock member leave and availability restoration" for US-019. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Joel | 2 |  |
| Handle concurrent acceptance with clear conflict responses | Complete the task "Handle concurrent acceptance with clear conflict responses" for US-019. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Edgar | 2 |  |
| Build React invitation response and roster status views | Complete the task "Build React invitation response and roster status views" for US-019. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Mohmedjuber | 2 |  |
| Add Vitest and integration tests for response transactions | Complete the task "Add Vitest and integration tests for response transactions" for US-019. Implement the Node.js/Express API or Firebase Auth integration with server-side validation, authorization, and explicit failure responses. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Wei | 2 |  |

Table 39: US-019 (disaggregated tasks)

### Acceptance Tests

- [ ] US-019-T1: Addressed PART accepts a current invitation with an open slot → Membership is confirmed, the slot fills, and availability is cleared
- [ ] US-019-T2: Addressed PART declines an invitation → Only that invitation changes and the owner is alerted
- [ ] US-019-T3: User accepts after the team fills or locks → Acceptance is rejected without partial changes
- [ ] US-019-T4: User accepts while another join is processed at the same time → One request succeeds and the other receives a clear conflict
- [ ] US-019-T5: Confirmed non-owner leaves before lock → Capacity and event availability are restored and the owner is alerted
- [ ] US-019-T6: Wrong user tries to respond or an owner tries to leave → Access is denied and the owner must disband instead

#### [US-020](../02_user_stories/user_stories.md#us-020)

**As a Team Lead, I want to review incoming applications and approve or decline candidates, so that I can select the best teammates for our vacancies.**

| Task | Description | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|---:|
| Build owner-only application review endpoint | Complete the task "Build owner-only application review endpoint" for US-020. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | sahil | 2.5 |  |
| Display permitted profile fields and application notes | Complete the task "Display permitted profile fields and application notes" for US-020. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Po-kai | 1 |  |
| Implement atomic approval with capacity and membership checks | Complete the task "Implement atomic approval with capacity and membership checks" for US-020. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Joel | 2 |  |
| Cancel competing requests after approval | Complete the task "Cancel competing requests after approval" for US-020. Implement the Node.js/Express API or Firebase Auth integration with server-side validation, authorization, and explicit failure responses. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Edgar | 1.5 |  |
| Implement decline outcome and basic alerts | Complete the task "Implement decline outcome and basic alerts" for US-020. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Mohmedjuber | 1.5 |  |
| Handle stale and repeated decisions idempotently | Complete the task "Handle stale and repeated decisions idempotently" for US-020. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Wei | 2 |  |
| Build React application review list and decision controls | Complete the task "Build React application review list and decision controls" for US-020. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | sahil | 3 |  |
| Add Vitest and integration tests for approval conflicts and permissions | Complete the task "Add Vitest and integration tests for approval conflicts and permissions" for US-020. Implement the Node.js/Express API or Firebase Auth integration with server-side validation, authorization, and explicit failure responses. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Po-kai | 2 |  |

Table 41: US-020 (disaggregated tasks)

### Acceptance Tests

- [ ] US-020-T1: Team Lead approves an eligible pending application → Membership is confirmed, the slot fills, and availability is cleared
- [ ] US-020-T2: Team Lead declines an application → The application is declined and membership and capacity remain unchanged
- [ ] US-020-T3: Team Lead approves after the slot or team is no longer eligible → The approval is rejected with a clear reason
- [ ] US-020-T4: Applicant already joined another team in the event → Approval is blocked
- [ ] US-020-T5: Non-owner opens the application review controls → The review and decision actions are denied
- [ ] US-020-T6: Team becomes full after approval → Remaining requests to the team are cancelled

#### [US-021](../02_user_stories/user_stories.md#us-021)

**As an active user, I want an in-app notification center that alerts me to invitations, applications, and event verification updates, so that I can take timely action.**

| Task | Description | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|---:|
| Create PostgreSQL notification model and unread indexes | Complete the task "Create PostgreSQL notification model and unread indexes" for US-021. Implement the Supabase PostgreSQL model or data operation with the required keys, constraints, indexes, and transaction behavior. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Joel | 2 |  |
| Create notification service for recruitment and event events | Complete the task "Create notification service for recruitment and event events" for US-021. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Edgar | 1 |  |
| Add Express notification list, read, and mark-all endpoints | Complete the task "Add Express notification list, read, and mark-all endpoints" for US-021. Implement the Node.js/Express API or Firebase Auth integration with server-side validation, authorization, and explicit failure responses. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Mohmedjuber | 2.5 |  |
| Build React navigation bell, unread badge, and dropdown | Complete the task "Build React navigation bell, unread badge, and dropdown" for US-021. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Wei | 2 |  |
| Add notification type labels and deep links to action views | Complete the task "Add notification type labels and deep links to action views" for US-021. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | sahil | 1.5 |  |
| Add real-time refresh or polling for new alerts | Complete the task "Add real-time refresh or polling for new alerts" for US-021. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Po-kai | 2 |  |
| Add empty, read, and permission states | Complete the task "Add empty, read, and permission states" for US-021. Implement the Node.js/Express API or Firebase Auth integration with server-side validation, authorization, and explicit failure responses. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Joel | 1.5 |  |
| Add Vitest and integration tests for notification creation and reading | Complete the task "Add Vitest and integration tests for notification creation and reading" for US-021. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Edgar | 2 |  |

Table 43: US-021 (disaggregated tasks)

### Acceptance Tests

- [ ] US-021-T1: Active user receives an invitation or application alert → The bell shows an unread count and the alert appears in the dropdown
- [ ] US-021-T2: User opens a notification → The relevant invitation or team review view opens
- [ ] US-021-T3: User marks one notification as read → Its unread state clears and the badge updates
- [ ] US-021-T4: User clicks Mark all as read → All displayed notifications become read
- [ ] US-021-T5: User has no notifications → A clear empty state appears
- [ ] US-021-T6: User tries to access another user's notifications → Only the user's own notifications are available

#### [US-022](../02_user_stories/user_stories.md#us-022)

**As a Team Lead, I want to confirm and lock my team's roster, so that our membership is finalized and membership mutations are frozen.**

| Task | Description | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|---:|
| Add team roster lock fields and server lock timestamp | Complete the task "Add team roster lock fields and server lock timestamp" for US-022. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Mohmedjuber | 1.5 |  |
| Build owner-only roster validation endpoint | Complete the task "Build owner-only roster validation endpoint" for US-022. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Wei | 2 |  |
| Implement atomic lock transaction with join and leave operations | Complete the task "Implement atomic lock transaction with join and leave operations" for US-022. Implement the Node.js/Express API or Firebase Auth integration with server-side validation, authorization, and explicit failure responses. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | sahil | 2 |  |
| Cancel pending invitations and applications on lock | Complete the task "Cancel pending invitations and applications on lock" for US-022. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Po-kai | 1 |  |
| Reject post-lock exits, removals, slot edits, and disbanding | Complete the task "Reject post-lock exits, removals, slot edits, and disbanding" for US-022. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Joel | 2 |  |
| Build React roster review, lock confirmation, and status views | Complete the task "Build React roster review, lock confirmation, and status views" for US-022. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Edgar | 1 |  |
| Add Vitest and integration tests for minimum, maximum, and concurrency rules | Complete the task "Add Vitest and integration tests for minimum, maximum, and concurrency rules" for US-022. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Mohmedjuber | 1.5 |  |

Table 45: US-022 (disaggregated tasks)

### Acceptance Tests

- [ ] US-022-T1: Team Lead locks a roster meeting official minimum and maximum → The roster locks and the server lock time is shown
- [ ] US-022-T2: Team Lead tries to lock an underfilled roster → Locking is rejected with the required member count
- [ ] US-022-T3: Team Lead locks while a join or leave is occurring → The operations resolve atomically and no partial roster is created
- [ ] US-022-T4: Member tries to leave or Team Lead edits a slot after lock → The mutation is rejected
- [ ] US-022-T5: PART or ADMIN who is not the owner tries to unlock or rewrite the roster → The action is denied
- [ ] US-022-T6: Team member opens the locked team → The locked roster and basic status confirmation are visible

#### [US-023](../02_user_stories/user_stories.md#us-023)

**As a confirmed team member, I want to access a private team workspace with shared communication links, project concept notes, and teammate contacts, so that we can coordinate before the hackathon begins.**

| Task | Description | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|---:|
| Create PostgreSQL locked-team workspace, link, note, and revision models | Complete the task "Create PostgreSQL locked-team workspace, link, note, and revision models" for US-023. Implement the Supabase PostgreSQL model or data operation with the required keys, constraints, indexes, and transaction behavior. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Wei | 2 |  |
| Add member-only workspace authorization for active locked teams | Complete the task "Add member-only workspace authorization for active locked teams" for US-023. Implement the Node.js/Express API or Firebase Auth integration with server-side validation, authorization, and explicit failure responses. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | sahil | 3 |  |
| Create owner-only HTTPS external-link endpoints | Complete the task "Create owner-only HTTPS external-link endpoints" for US-023. Implement the Node.js/Express API or Firebase Auth integration with server-side validation, authorization, and explicit failure responses. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Po-kai | 2 |  |
| Create shared markdown note and revision endpoints | Complete the task "Create shared markdown note and revision endpoints" for US-023. Implement the Node.js/Express API or Firebase Auth integration with server-side validation, authorization, and explicit failure responses. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Joel | 1.5 |  |
| Add stale-save conflict handling using revision versions | Complete the task "Add stale-save conflict handling using revision versions" for US-023. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Edgar | 2 |  |
| Build React workspace, member contacts, links, note editor, and revisions | Complete the task "Build React workspace, member contacts, links, note editor, and revisions" for US-023. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Mohmedjuber | 3 |  |
| Apply privacy rules and deletion handling for shared data | Complete the task "Apply privacy rules and deletion handling for shared data" for US-023. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Wei | 2 |  |
| Add Vitest and integration tests for workspace access and concurrent saves | Complete the task "Add Vitest and integration tests for workspace access and concurrent saves" for US-023. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | sahil | 0.5 |  |

Table 47: US-023 (disaggregated tasks)

### Acceptance Tests

- [ ] US-023-T1: Confirmed member opens a locked team's workspace → The workspace shows permitted contacts, links, roles, and notes
- [ ] US-023-T2: Owner adds an HTTPS communication link → The link is saved and visible to team members
- [ ] US-023-T3: Non-owner tries to add or edit the shared external link → The action is denied
- [ ] US-023-T4: Member edits and saves the shared markdown note → A new revision records the author and time
- [ ] US-023-T5: Two members save an old version at the same time → The stale save is rejected instead of overwriting the newer note
- [ ] US-023-T6: Visitor, unrelated PART, or ADMIN without membership opens the workspace → Access is denied and account email is not exposed

#### [US-024](../02_user_stories/user_stories.md#us-024)

**As a confirmed member of a locked team, I want to export our roster record, so that we can share consistent team information if an event accepts it.**

| Task | Description | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|---:|
| Define canonical roster snapshot serialization | Complete the task "Define canonical roster snapshot serialization" for US-024. Implement the Supabase PostgreSQL model or data operation with the required keys, constraints, indexes, and transaction behavior. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Po-kai | 2 |  |
| Create export service for HTML, PDF, and JSON formats | Complete the task "Create export service for HTML, PDF, and JSON formats" for US-024. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Joel | 1 |  |
| Add checksum generation and included-field change detection | Complete the task "Add checksum generation and included-field change detection" for US-024. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Edgar | 2 |  |
| Build React export controls and download states | Complete the task "Build React export controls and download states" for US-024. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Mohmedjuber | 1.5 |  |
| Exclude email and private contact fields from exports | Complete the task "Exclude email and private contact fields from exports" for US-024. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Wei | 2 |  |
| Add locked-member authorization and historical snapshot handling | Complete the task "Add locked-member authorization and historical snapshot handling" for US-024. Implement the Supabase PostgreSQL model or data operation with the required keys, constraints, indexes, and transaction behavior. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | sahil | 2.5 |  |
| Add Vitest and integration tests for export content and checksums | Complete the task "Add Vitest and integration tests for export content and checksums" for US-024. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Po-kai | 1 |  |

Table 49: US-024 (disaggregated tasks)

### Acceptance Tests

- [ ] US-024-T1: Confirmed locked-team member exports the roster as JSON → The file contains the team, event, lock time, member names, institutions, handles, and roles
- [ ] US-024-T2: Member exports the printable HTML or PDF card → A readable roster card is downloaded
- [ ] US-024-T3: Member exports the same unchanged snapshot twice → Both exports contain the same checksum
- [ ] US-024-T4: An included roster field changes and the member exports again → The checksum changes
- [ ] US-024-T5: Export viewer checks the labels → The lock time is labelled as recorded by HackMatch and the checksum as an integrity check
- [ ] US-024-T6: Visitor or non-member tries to export a team → Export is denied

#### [US-025](../02_user_stories/user_stories.md#us-025)

**As a Participant, I want to report an abusive profile, offensive team listing, or suspicious external URL, so that Administrators can investigate misconduct.**

| Task | Description | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|---:|
| Create PostgreSQL moderation-report model and target references | Complete the task "Create PostgreSQL moderation-report model and target references" for US-025. Implement the Supabase PostgreSQL model or data operation with the required keys, constraints, indexes, and transaction behavior. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Joel | 2 |  |
| Build report modal for profiles, teams, and event listings | Complete the task "Build report modal for profiles, teams, and event listings" for US-025. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Edgar | 2.5 |  |
| Add category and optional explanation validation | Complete the task "Add category and optional explanation validation" for US-025. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Mohmedjuber | 1 |  |
| Enforce five reports per account per rolling hour | Complete the task "Enforce five reports per account per rolling hour" for US-025. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Wei | 2 |  |
| Create US-026 moderation cases and receipt confirmation | Complete the task "Create US-026 moderation cases and receipt confirmation" for US-025. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | sahil | 2 |  |
| Protect reports from other participants and apply PART authentication | Complete the task "Protect reports from other participants and apply PART authentication" for US-025. Implement the Node.js/Express API or Firebase Auth integration with server-side validation, authorization, and explicit failure responses. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Po-kai | 2 |  |
| Add Vitest and integration tests for report limits and targets | Complete the task "Add Vitest and integration tests for report limits and targets" for US-025. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Joel | 1.5 |  |

Table 51: US-025 (disaggregated tasks)

### Acceptance Tests

- [ ] US-025-T1: Signed-in PART reports a visible team listing with a category → A moderation case is created and receipt is confirmed
- [ ] US-025-T2: PART submits an optional explanation with the report → The explanation is saved with the case
- [ ] US-025-T3: PART submits a sixth report within one rolling hour → The report is rejected with a retry message
- [ ] US-025-T4: Another PART tries to read someone else's report → The report is not accessible
- [ ] US-025-T5: Visitor tries to submit a report → The report action requires signed-in PART access

#### [US-026](../02_user_stories/user_stories.md#us-026)

**As a Platform Administrator, I want to review flagged team content and malicious links in a moderation queue, so that the platform remains safe, compliant, and free of phishing threats.**

| Task | Description | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|---:|
| Create moderation-case queue and target-detail Express endpoints | Complete the task "Create moderation-case queue and target-detail Express endpoints" for US-026. Implement the Node.js/Express API or Firebase Auth integration with server-side validation, authorization, and explicit failure responses. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Edgar | 1.5 |  |
| Protect moderation routes with ADMIN RBAC middleware | Complete the task "Protect moderation routes with ADMIN RBAC middleware" for US-026. Implement the Node.js/Express API or Firebase Auth integration with server-side validation, authorization, and explicit failure responses. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Mohmedjuber | 2 |  |
| Build newest-first React safety queue and case view | Complete the task "Build newest-first React safety queue and case view" for US-026. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Wei | 2 |  |
| Add dismiss, redact, warn, hide, and URL-disable actions | Complete the task "Add dismiss, redact, warn, hide, and URL-disable actions" for US-026. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | sahil | 3 |  |
| Require a reason and create safe action records for each decision | Complete the task "Require a reason and create safe action records for each decision" for US-026. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Po-kai | 2 |  |
| Remove hidden content from discovery and preserve historical memberships | Complete the task "Remove hidden content from discovery and preserve historical memberships" for US-026. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Joel | 2 |  |
| Hide credentials, private contacts, and private workspace data from cases | Complete the task "Hide credentials, private contacts, and private workspace data from cases" for US-026. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Edgar | 2.5 |  |
| Add Vitest and integration tests for moderation actions and access | Complete the task "Add Vitest and integration tests for moderation actions and access" for US-026. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Mohmedjuber | 2.5 |  |

Table 53: US-026 (disaggregated tasks)

### Acceptance Tests

- [ ] US-026-T1: ADMIN opens the moderation queue → Cases appear newest first with targets, reasons, and times
- [ ] US-026-T2: ADMIN hides a flagged team listing with a reason → The listing is removed from ordinary discovery and its owner can see the status
- [ ] US-026-T3: ADMIN confirms a malicious URL → The URL is disabled immediately and related recruitment is stopped when required
- [ ] US-026-T4: ADMIN tries to complete an action without a reason → The action is rejected
- [ ] US-026-T5: PART or Visitor tries to open or invoke moderation controls → Access is denied
- [ ] US-026-T6: ADMIN opens a case for a private workspace → Private workspace access and private contacts are not granted

#### [US-027](../02_user_stories/user_stories.md#us-027)

**As a Platform Administrator, I want to suspend or deactivate non-compliant accounts, so that bad actors cannot harass students or disrupt team formation.**

| Task | Description | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|---:|
| Create ADMIN account-management list and detail endpoints | Complete the task "Create ADMIN account-management list and detail endpoints" for US-027. Implement the Node.js/Express API or Firebase Auth integration with server-side validation, authorization, and explicit failure responses. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Wei | 2 |  |
| Add suspension, deactivation, and deletion-request data models | Complete the task "Add suspension, deactivation, and deletion-request data models" for US-027. Implement the Supabase PostgreSQL model or data operation with the required keys, constraints, indexes, and transaction behavior. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | sahil | 2 |  |
| Implement session revocation and sign-in blocking on suspension | Complete the task "Implement session revocation and sign-in blocking on suspension" for US-027. Implement the Node.js/Express API or Firebase Auth integration with server-side validation, authorization, and explicit failure responses. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Po-kai | 2 |  |
| Cancel pending requests, hide profiles, and pause owned recruitment | Complete the task "Cancel pending requests, hide profiles, and pause owned recruitment" for US-027. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Joel | 1.5 |  |
| Implement ownership-verified deletion and 30-day target workflow | Complete the task "Implement ownership-verified deletion and 30-day target workflow" for US-027. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Edgar | 1 |  |
| Pseudonymize historical membership fields while preserving locked rosters | Complete the task "Pseudonymize historical membership fields while preserving locked rosters" for US-027. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Mohmedjuber | 2 |  |
| Protect credentials, OTPs, notes, and public ADMIN self-promotion | Complete the task "Protect credentials, OTPs, notes, and public ADMIN self-promotion" for US-027. Implement the Node.js/Express API or Firebase Auth integration with server-side validation, authorization, and explicit failure responses. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Wei | 2 |  |
| Build React account enforcement views and reason forms | Complete the task "Build React account enforcement views and reason forms" for US-027. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | sahil | 3 |  |
| Add Vitest and integration tests for suspension and deletion rules | Complete the task "Add Vitest and integration tests for suspension and deletion rules" for US-027. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Po-kai | 1 |  |

Table 55: US-027 (disaggregated tasks)

### Acceptance Tests

- [ ] US-027-T1: ADMIN suspends a non-compliant account with a reason → Sessions are revoked, sign-in is blocked, and the profile is hidden
- [ ] US-027-T2: Suspended user tries to sign in or use a current session → Access is denied
- [ ] US-027-T3: ADMIN suspends an account that owns an unlocked team → Recruitment pauses and outgoing invitations are cancelled without deleting unrelated teams
- [ ] US-027-T4: ADMIN submits an ownership-verified deletion request → The request is recorded and live identifying data enters the deletion workflow
- [ ] US-027-T5: ADMIN tries to delete an unlocked team owner who has not disbanded → Deletion is blocked until the owner disbands
- [ ] US-027-T6: PART tries to use account-management controls → Access is denied

#### [US-028](../02_user_stories/user_stories.md#us-028)

**As an Administrator, I want to review and filter administrative action records, so that I can investigate past decisions.**

| Task | Description | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|---:|
| Create append-only audit-record query endpoint | Complete the task "Create append-only audit-record query endpoint" for US-028. Implement the Supabase PostgreSQL model or data operation with the required keys, constraints, indexes, and transaction behavior. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Joel | 2 |  |
| Build React audit table with record ID, actor, action, target, reason, outcome, and UTC time | Complete the task "Build React audit table with record ID, actor, action, target, reason, outcome, and UTC time" for US-028. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Edgar | 1 |  |
| Add actor, action-type, and date filters | Complete the task "Add actor, action-type, and date filters" for US-028. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Mohmedjuber | 1.5 |  |
| Add empty state and pagination for no or many results | Complete the task "Add empty state and pagination for no or many results" for US-028. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Wei | 2 |  |
| Apply read-only ADMIN permissions and deny record mutations | Complete the task "Apply read-only ADMIN permissions and deny record mutations" for US-028. Implement the Supabase PostgreSQL model or data operation with the required keys, constraints, indexes, and transaction behavior. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | sahil | 2.5 |  |
| Apply retention and pseudonymization display rules | Complete the task "Apply retention and pseudonymization display rules" for US-028. Implement the React (Vite) frontend behavior and its loading, success, validation, empty, and error states. Include the fields and rules from the linked story, preserve existing data on validation errors, and cover the user-visible success and failure outcomes. | Po-kai | 2 |  |
| Add Vitest and integration tests for filters and access | Complete the task "Add Vitest and integration tests for filters and access" for US-028. Implement the supporting application behavior across the React, Node.js/Express, PostgreSQL/Supabase, and Firebase Auth layers as applicable. Verify the happy path, invalid input, unauthorized access, boundary conditions, and failure handling with repeatable evidence. | Joel | 1.5 |  |

Table 57: US-028 (disaggregated tasks)

### Acceptance Tests

- [ ] US-028-T1: ADMIN opens the audit review page → Event, moderation, and account action records are displayed
- [ ] US-028-T2: ADMIN filters by actor, action type, and date → Only matching records are shown
- [ ] US-028-T3: ADMIN searches for a combination with no matches → A clear empty state appears
- [ ] US-028-T4: ADMIN opens a record → The record ID, actor, target, safe summary, reason, outcome, and UTC time are visible
- [ ] US-028-T5: PART or Visitor opens the audit page → Access is denied
- [ ] US-028-T6: User tries to edit or delete an audit record through ordinary controls → No mutation is allowed

<a id="us-030"></a>

#### [US-030](../02_user_stories/user_stories.md#us-030) — Participant Chat Forums and Messaging

**As a Participant (hacker), I want in-app forums and messaging with presence statuses, so that I can open topic channels with a title and description, collaborate with other hackers, and send messages in-app.**

**Sprint note:** Schedule **US-030 only** in the **≈3-day** Must-Have window (FR-086–FR-089). **US-031–US-034** are Should-Have next sprint. **US-035** is May-Have future.

| Task | Description | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|---:|
| Create chat channel and message PostgreSQL models | Complete the task "Create chat channel and message PostgreSQL models" for US-030. Implement forums/channels (title, description, created_by, timestamps) and messages (channel_id, author_id, body, created_at) with indexes and constraints. | Joel | 3 |  |
| Add participant presence-status field and update API | Complete the task "Add participant presence-status field and update API" for US-030. Support Online, Idle, Do Not Disturb, Invisible (FR-086); deny Visitors and suspended/unverified accounts. | sahil | 2 |  |
| Create Express channel list/create and message list/send endpoints | Complete the task "Create Express channel list/create and message list/send endpoints" for US-030. Server-side validation for title/description/message; explicit 401/403/400; preserve submitted drafts on validation errors (FR-087, FR-088). | Po-kai | 3 |  |
| Enforce chat privacy — no credentials, OTPs, or emails in payloads | Complete the task "Enforce chat privacy — no credentials, OTPs, or emails in payloads" for US-030. Scrub sensitive fields from chat responses (FR-089). | Joel | 1.5 |  |
| Build React Chat page — status, forum list/create, message thread | Complete the task "Build React Chat page — status, forum list/create, message thread" for US-030. Loading, empty, validation, success, and error states; keep drafts on failure. | sahil | 4 |  |
| Add Vitest and route tests for chat happy path, auth, and validation | Complete the task "Add Vitest and route tests for chat happy path, auth, and validation" for US-030. Cover unauthorized access, blank title/message, and privacy scrubbing with offline evidence. | Po-kai | 2.5 |  |

Table 59: US-030 (disaggregated tasks)

### Acceptance Tests

- [ ] US-030-T1: Verified PART sets presence to Online → Status is stored and returned to permitted peers
- [ ] US-030-T2: PART creates a forum with title and description → Channel appears in the list
- [ ] US-030-T3: PART sends a text message in a channel → Message shows author handle, time, and content
- [ ] US-030-T4: Visitor or unverified user opens Chat → Access is denied / gated
- [ ] US-030-T5: Blank title or blank message submitted → Validation error; draft kept
- [ ] US-030-T6: Chat API response inspected → No password, OTP, or email fields present

#### [US-031](../02_user_stories/user_stories.md#us-031) — Team-Scoped Chat Channels *(Should-Have — next sprint)*

**As a confirmed team member, I want a private team chat channel limited to my teammates, so that we can coordinate without exposing messages to the whole platform.**

| Task | Description | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|---:|
| Extend chat channel model with team_id and membership scope | Complete the task "Extend chat channel model with team_id and membership scope" for US-031. Link channels to teams; enforce confirmed-member-only access (FR-090). | sahil | 2 |  |
| Add Express authorize-membership middleware for team channels | Complete the task "Add Express authorize-membership middleware for team channels" for US-031. Non-members receive 403 with no message leakage. | Po-kai | 2 |  |
| Create or auto-link a team channel from the team workspace | Complete the task "Create or auto-link a team channel from the team workspace" for US-031. Owner/member entry points respect US-012 / US-022 lifecycle. | Joel | 2 |  |
| Build React team-channel view with empty and denied states | Complete the task "Build React team-channel view with empty and denied states" for US-031. Loading, success, validation, empty, and error states; drafts kept on failure. | Po-kai | 2 |  |
| Add Vitest and integration tests for member vs non-member access | Complete the task "Add Vitest and integration tests for member vs non-member access" for US-031. Verify happy path, unauthorized access, and failure handling. | Joel | 1.5 |  |

Table 60: US-031 (disaggregated tasks)

### Acceptance Tests

- [ ] US-031-T1: Confirmed member opens their team channel → Messages load
- [ ] US-031-T2: Non-member requests the same channel → 403 and no content
- [ ] US-031-T3: Visitor opens a team channel URL → Access denied
- [ ] US-031-T4: Member sends a message → Appears for other confirmed members only
- [ ] US-031-T5: Blank message submitted → Validation error; draft kept

#### [US-032](../02_user_stories/user_stories.md#us-032) — Direct Messaging Between Participants *(Should-Have — next sprint)*

**As a Participant, I want to exchange private direct messages with another Participant, so that we can connect one-to-one while recruiting or collaborating.**

| Task | Description | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|---:|
| Create DM thread model and participant pair uniqueness | Complete the task "Create DM thread model and participant pair uniqueness" for US-032. One thread per unordered PART pair; indexes and constraints (FR-091). | Joel | 2 |  |
| Create Express DM list/open/send endpoints | Complete the task "Create Express DM list/open/send endpoints" for US-032. Deny suspended/unverified/blocked peers; preserve drafts on validation errors. | sahil | 2.5 |  |
| Enforce DM privacy scrubbing | Complete the task "Enforce DM privacy scrubbing" for US-032. No credentials, OTPs, or emails in DM payloads. | Po-kai | 1 |  |
| Build React DM inbox and thread composer | Complete the task "Build React DM inbox and thread composer" for US-032. Loading, empty, validation, success, and error states. | Joel | 2.5 |  |
| Add Vitest and route tests for DM auth and validation | Complete the task "Add Vitest and route tests for DM auth and validation" for US-032. Cover unauthorized access and failure handling. | sahil | 1.5 |  |

Table 61: US-032 (disaggregated tasks)

### Acceptance Tests

- [ ] US-032-T1: Two verified PART users open a DM → Thread is created or reused
- [ ] US-032-T2: Third party requests that DM → 403
- [ ] US-032-T3: Suspended peer is messaged → Send is denied
- [ ] US-032-T4: Blank DM body submitted → Validation error; draft kept
- [ ] US-032-T5: DM payload inspected → No password, OTP, or email fields

#### [US-033](../02_user_stories/user_stories.md#us-033) — Chat Moderation and Reporting Hooks *(Should-Have — next sprint)*

**As a Platform Administrator, I want to open moderation cases against abusive chat channels or messages, so that collaboration stays safe without exposing private credentials.**

| Task | Description | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|---:|
| Extend moderation target types for channel and message | Complete the task "Extend moderation target types for channel and message" for US-033. Allow US-026 cases against chat targets (FR-092). | Po-kai | 2 |  |
| Add safe chat summary projection for case detail | Complete the task "Add safe chat summary projection for case detail" for US-033. Show handles/times/safe body rules; never credentials/OTPs/emails. | Joel | 2 |  |
| Wire ADMIN open-case UI for chat targets | Complete the task "Wire ADMIN open-case UI for chat targets" for US-033. Mandatory reason; draft preserved on validation failure. | sahil | 2 |  |
| Optional PART report-from-message when US-025 is available | Complete the task "Optional PART report-from-message when US-025 is available" for US-033. Create case intake without exposing other users’ reports. | Po-kai | 1.5 |  |
| Add Vitest and integration tests for chat moderation access | Complete the task "Add Vitest and integration tests for chat moderation access" for US-033. PART/Visitor denied; ADMIN happy path and validation. | Joel | 1.5 |  |

Table 62: US-033 (disaggregated tasks)

### Acceptance Tests

- [ ] US-033-T1: ADMIN opens a case on a message with a reason → Case appears in the safety queue
- [ ] US-033-T2: Case detail shows safe chat summary → No credentials/OTPs/emails
- [ ] US-033-T3: PART tries ADMIN chat moderation controls → Access denied
- [ ] US-033-T4: Decide without reason → Validation error; draft kept
- [ ] US-033-T5: Action record written → Actor, target, reason, outcome, UTC time present

#### [US-034](../02_user_stories/user_stories.md#us-034) — Chat Unread and Mention Badges *(Should-Have — after US-030 and US-021)*

**As a Participant, I want unread counts and mention badges for chat activity, so that I notice new messages without constantly polling every channel.**

| Task | Description | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|---:|
| Persist last-read cursor per participant and channel/DM | Complete the task "Persist last-read cursor per participant and channel/DM" for US-034. Support unread calculation (FR-094). | sahil | 2 |  |
| Compute unread and mention badge counts API | Complete the task "Compute unread and mention badge counts API" for US-034. No cross-account leakage. | Joel | 2 |  |
| Surface badges in React nav / US-021 notification centre | Complete the task "Surface badges in React nav / US-021 notification centre" for US-034. Zero-count empty state is clear. | Po-kai | 2 |  |
| Mark thread read clears badges | Complete the task "Mark thread read clears badges" for US-034. Counts stay accurate after refresh. | sahil | 1.5 |  |
| Add Vitest tests for increment and clear behaviour | Complete the task "Add Vitest tests for increment and clear behaviour" for US-034. Verify unauthorized access denial. | Po-kai | 1 |  |

Table 63: US-034 (disaggregated tasks)

### Acceptance Tests

- [ ] US-034-T1: New message arrives in a channel → Unread count increments for other members
- [ ] US-034-T2: Member opens/marks the thread read → Unread count clears
- [ ] US-034-T3: Mention convention matched → Mention badge updates
- [ ] US-034-T4: Another account’s badges requested → Access denied / no leak
- [ ] US-034-T5: Zero unread → Clear empty / zero state

#### [US-035](../02_user_stories/user_stories.md#us-035) — Rich Chat Media and Realtime Extras *(May-Have — future)*

**As a Participant, I want richer chat interactions such as reactions, typing indicators, file attachments, or voice/video, so that collaboration feels closer to a full realtime workspace.**

| Task | Description | Who | Estimate (h) | Actual (h) |
|---|---|---:|---:|---:|
| Design approval gate for rich media / realtime extras | Complete the task "Design approval gate for rich media / realtime extras" for US-035. No implementation until FR-093 design approval. | Joel | — |  |
| Spike reactions and typing indicators (optional) | Complete the task "Spike reactions and typing indicators" for US-035 only after approval; preserve US-030 privacy and auth boundaries. | sahil | — |  |
| Spike attachments with MIME/size policy (optional) | Complete the task "Spike attachments with MIME/size policy" for US-035 only after approval. | Po-kai | — |  |
| Spike voice/video feasibility (optional) | Complete the task "Spike voice/video feasibility" for US-035 only after security/capacity review. | Joel | — |  |

Table 64: US-035 (disaggregated tasks)

### Acceptance Tests

- [ ] US-035-T1: Feature flagged off by default → US-030 MVP acceptance unaffected
- [ ] US-035-T2: Any future rich-media API → Still omits credentials/OTPs/emails
- [ ] US-035-T3: Unauthorized user → Cannot access rich-media endpoints

## Summary

| Story ID | Number of tasks | Total estimated hours | Number of acceptance tests |
|---|---:|---:|---:|
| [US-001](../02_user_stories/user_stories.md#us-001) | 8 |  | 6 |
| [US-002](../02_user_stories/user_stories.md#us-002) | 8 |  | 6 |
| [US-003](../02_user_stories/user_stories.md#us-003) | 8 |  | 5 |
| [US-004](../02_user_stories/user_stories.md#us-004) | 8 |  | 6 |
| [US-005](../02_user_stories/user_stories.md#us-005) | 7 |  | 5 |
| [US-006](../02_user_stories/user_stories.md#us-006) | 8 |  | 6 |
| [US-007](../02_user_stories/user_stories.md#us-007) | 7 |  | 6 |
| [US-029](../02_user_stories/user_stories.md#us-029) | 7 |  | 6 |
| ~~[US-008](../02_user_stories/user_stories.md#us-008)~~ *(out of scope)* | 8 | — | 6 |
| ~~[US-009](../02_user_stories/user_stories.md#us-009)~~ *(out of scope)* | 8 | — | 6 |
| ~~[US-010](../02_user_stories/user_stories.md#us-010)~~ *(out of scope)* | 9 | — | 6 |
| [US-011](../02_user_stories/user_stories.md#us-011) | 8 |  | 5 |
| [US-012](../02_user_stories/user_stories.md#us-012) | 9 |  | 6 |
| [US-013](../02_user_stories/user_stories.md#us-013) | 7 |  | 6 |
| [US-014](../02_user_stories/user_stories.md#us-014) | 7 |  | 5 |
| [US-015](../02_user_stories/user_stories.md#us-015) | 8 |  | 6 |
| [US-016](../02_user_stories/user_stories.md#us-016) | 7 |  | 5 |
| [US-017](../02_user_stories/user_stories.md#us-017) | 8 |  | 6 |
| [US-018](../02_user_stories/user_stories.md#us-018) | 8 |  | 6 |
| [US-019](../02_user_stories/user_stories.md#us-019) | 8 |  | 6 |
| [US-020](../02_user_stories/user_stories.md#us-020) | 8 |  | 6 |
| [US-021](../02_user_stories/user_stories.md#us-021) | 8 |  | 6 |
| [US-022](../02_user_stories/user_stories.md#us-022) | 7 |  | 6 |
| [US-023](../02_user_stories/user_stories.md#us-023) | 8 |  | 6 |
| [US-024](../02_user_stories/user_stories.md#us-024) | 7 |  | 6 |
| [US-025](../02_user_stories/user_stories.md#us-025) | 7 |  | 5 |
| [US-026](../02_user_stories/user_stories.md#us-026) | 8 |  | 6 |
| [US-027](../02_user_stories/user_stories.md#us-027) | 9 |  | 6 |
| [US-028](../02_user_stories/user_stories.md#us-028) | 7 |  | 6 |
| [US-030](../02_user_stories/user_stories.md#us-030) Must-Have (3-day) | 6 | 16 | 6 |
| [US-031](../02_user_stories/user_stories.md#us-031) Should-Have | 5 | 9.5 | 5 |
| [US-032](../02_user_stories/user_stories.md#us-032) Should-Have | 5 | 9.5 | 5 |
| [US-033](../02_user_stories/user_stories.md#us-033) Should-Have | 5 | 9 | 5 |
| [US-034](../02_user_stories/user_stories.md#us-034) Should-Have | 5 | 8.5 | 5 |
| [US-035](../02_user_stories/user_stories.md#us-035) May-Have | 4 | — | 3 |
| **Total (historical rows)** | **255** |  | **193** |
