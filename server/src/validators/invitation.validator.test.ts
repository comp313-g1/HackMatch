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
      slotId: vacancyId,
      inviteeParticipantId,
      inviteeId: inviteeParticipantId,
      source: 'recommendation',
    });
  });

  it('accepts slotId and inviteeId aliases without vacancyId or inviteeParticipantId', () => {
    const result = validateIssueInvitationInput({
      slotId: vacancyId,
      inviteeId: inviteeParticipantId,
      source: 'direct',
    });
    expect(result.errors).toEqual({});
    expect(result.sanitized).toEqual({
      vacancyId,
      slotId: vacancyId,
      inviteeParticipantId,
      inviteeId: inviteeParticipantId,
      source: 'direct',
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

  it('rejects obsolete eventId if passed in request body', () => {
    const result = validateIssueInvitationInput({
      slotId: vacancyId,
      inviteeId: inviteeParticipantId,
      eventId: '11111111-1111-4111-8111-111111111111',
    });
    expect(result.sanitized).toBeNull();
    expect(result.errors.eventId).toMatch(/Unknown field "eventId"/i);
  });
});
