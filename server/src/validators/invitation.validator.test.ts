import { describe, it, expect } from 'vitest';
import { validateIssueInvitationInput } from './invitation.validator.js';

const vacancyId = '66666666-6666-4666-8666-666666666666';
const inviteeParticipantId = '22222222-2222-4222-8222-222222222222';

describe('validateIssueInvitationInput (US-017 / FR-048)', () => {
  it('accepts recommendation-sourced invitation with valid UUIDs', () => {
    const result = validateIssueInvitationInput({
      vacancyId,
      inviteeParticipantId,
      source: 'recommendation',
    });
    expect(result.errors).toEqual({});
    expect(result.sanitized).toEqual({
      vacancyId,
      inviteeParticipantId,
      source: 'recommendation',
    });
  });

  it('defaults source to direct when omitted', () => {
    const result = validateIssueInvitationInput({ vacancyId, inviteeParticipantId });
    expect(result.sanitized?.source).toBe('direct');
  });

  it('rejects invalid UUIDs and keeps field errors without sanitizing', () => {
    const result = validateIssueInvitationInput({
      vacancyId: 'not-a-uuid',
      inviteeParticipantId: 'also-bad',
      source: 'recommendation',
    });
    expect(result.sanitized).toBeNull();
    expect(result.errors.vacancyId).toMatch(/valid UUID/i);
    expect(result.errors.inviteeParticipantId).toMatch(/valid UUID/i);
  });

  it('rejects unknown fields', () => {
    const result = validateIssueInvitationInput({
      vacancyId,
      inviteeParticipantId,
      message: 'hi',
    });
    expect(result.sanitized).toBeNull();
    expect(result.errors.message).toMatch(/Unknown field/i);
  });
});
