/**
 * Recommendation → invite client (FR-048). Re-exports the shared US-017 invitations API
 * so direct and recommendation issuance stay on one module (#167).
 */
export {
  AuthRequiredError,
  InvitationsApiError,
  TeamInvitationsApiError,
  issueTeamInvitation,
  type IssuedInvitation,
  type IssueInvitationPayload,
} from '../teams/invitationsApi';
