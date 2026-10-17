/**
 * US-006 Profile Integration Test Suite (React UI & Client Lifecycle).
 *
 * Exercises the end-to-end profile editor form, client-side validation,
 * API integration via authFetch, and candidate profile card rendering across
 * all viewer categories (VISITOR, PART, CONFIRMED_TEAMMATE, OWNER).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React, { useState } from 'react';
import { ProfileEditorForm } from './ProfileEditorForm';
import {
  CandidateProfileCard,
  type CandidateProfileData,
  type ProfileViewerCategory,
} from './CandidateProfileCard';
import * as authFetchModule from '../../config/authFetch';

/**
 * Integrated wrapper component simulating an authenticated participant profile dashboard
 * that switches to the candidate preview card once profile is updated.
 */
function IntegratedProfileManager({
  initialProfile,
  initialViewerCategory = 'OWNER',
}: {
  initialProfile?: CandidateProfileData;
  initialViewerCategory?: ProfileViewerCategory;
}) {
  const [profile, setProfile] = useState<CandidateProfileData | undefined>(initialProfile);
  const [viewerCategory, setViewerCategory] = useState<ProfileViewerCategory>(initialViewerCategory);
  const [isEditing, setIsEditing] = useState(false);

  return (
    <div data-testid="profile-manager">
      <div className="flex gap-2 mb-4">
        <button onClick={() => setIsEditing(!isEditing)}>
          {isEditing ? 'Cancel Edit' : 'Edit Profile'}
        </button>
        <button onClick={() => setViewerCategory('VISITOR')}>View as Visitor</button>
        <button onClick={() => setViewerCategory('PART')}>View as Non-Teammate PART</button>
        <button onClick={() => setViewerCategory('CONFIRMED_TEAMMATE')}>
          View as Teammate
        </button>
      </div>

      {isEditing ? (
        <ProfileEditorForm
          initialValues={{
            handle: profile?.handle ?? '',
            primaryRole: profile?.primaryRole ?? '',
            institution: profile?.institution ?? '',
            skills: profile?.skills ?? [],
            portfolioLinks: profile?.portfolioLinks?.map((p) => ({
              url: p.url,
              label: p.label ?? '',
            })) ?? [{ url: '', label: '' }],
            sharedContactHandle: profile?.sharedContactHandle ?? '',
          }}
          onSaved={(saved) => {
            setProfile(saved);
            setIsEditing(false);
          }}
        />
      ) : profile ? (
        <CandidateProfileCard viewerCategory={viewerCategory} profile={profile} />
      ) : (
        <p>No profile found.</p>
      )}
    </div>
  );
}

describe('US-006 Profile Management Client Integration (UI + authFetch + Privacy Projections)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('allows participant to edit profile, validates input, calls authFetch, and renders updated CandidateProfileCard (US-006-T1 / T5)', async () => {
    const updatedBackendProfile = {
      displayName: 'Alex Builder',
      handle: 'alex_builder',
      primaryRole: 'Backend',
      institution: 'Centennial College',
      skills: ['Node.js', 'PostgreSQL', 'Docker'],
      portfolioLinks: [
        {
          url: 'https://github.com/alex_builder',
          label: 'GitHub',
          isSelfDeclared: true,
        },
      ],
      sharedContactHandle: '@alex_discord',
      sharedContactAudienceNotice:
        'Shared contact handle is visible only to confirmed teammates.',
    };

    vi.spyOn(authFetchModule, 'authFetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          message: 'Profile updated successfully.',
          profile: updatedBackendProfile,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    render(<IntegratedProfileManager />);

    // Step 1: Open profile editor
    fireEvent.click(screen.getByRole('button', { name: /edit profile/i }));

    // Step 2: Fill in valid profile fields
    fireEvent.change(screen.getByLabelText(/display handle/i), {
      target: { value: 'alex_builder' },
    });
    fireEvent.change(screen.getByLabelText(/primary role/i), {
      target: { value: 'Backend' },
    });
    fireEvent.change(screen.getByLabelText(/academic institution/i), {
      target: { value: 'Centennial College' },
    });
    fireEvent.change(screen.getByLabelText(/skill tags/i), {
      target: { value: 'Node.js, PostgreSQL, Docker' },
    });
    fireEvent.change(screen.getByLabelText(/portfolio https url 1/i), {
      target: { value: 'https://github.com/alex_builder' },
    });
    fireEvent.change(screen.getByLabelText(/portfolio label 1/i), {
      target: { value: 'GitHub' },
    });
    fireEvent.change(screen.getByLabelText(/shared contact handle/i), {
      target: { value: '@alex_discord' },
    });

    // Step 3: Save profile
    fireEvent.click(screen.getByRole('button', { name: /save technical profile/i }));

    // Step 4: Verify CandidateProfileCard displays updated data with self-declared badge
    await waitFor(() => {
      expect(screen.getByText('@alex_builder')).toBeInTheDocument();
    });
    expect(screen.getByText('Backend')).toBeInTheDocument();
    expect(screen.getByText(/centennial college/i)).toBeInTheDocument();
    expect(screen.getByText('Node.js')).toBeInTheDocument();
    expect(screen.getByText('PostgreSQL')).toBeInTheDocument();
    expect(screen.getByText('Docker')).toBeInTheDocument();
    expect(screen.getAllByText(/self-declared/i).length).toBeGreaterThanOrEqual(2);

    // In OWNER view, shared contact is visible
    expect(screen.getByText('@alex_discord')).toBeInTheDocument();

    // Step 5: Switch viewer category to VISITOR -> anonymized view hides handles, skills, and contacts
    fireEvent.click(screen.getByRole('button', { name: /view as visitor/i }));
    expect(screen.getByText('Anonymous Participant')).toBeInTheDocument();
    expect(screen.getByText('Backend')).toBeInTheDocument();
    expect(screen.getByText(/3 declared skill tags/i)).toBeInTheDocument();
    expect(screen.queryByText('@alex_builder')).not.toBeInTheDocument();
    expect(screen.queryByText('@alex_discord')).not.toBeInTheDocument();
    expect(screen.queryByText('Node.js')).not.toBeInTheDocument();

    // Step 6: Switch viewer category to non-teammate PART -> skills visible, contact hidden
    fireEvent.click(screen.getByRole('button', { name: /view as non-teammate part/i }));
    expect(screen.getByText('@alex_builder')).toBeInTheDocument();
    expect(screen.getByText('Node.js')).toBeInTheDocument();
    expect(screen.queryByText('@alex_discord')).not.toBeInTheDocument();

    // Step 7: Switch viewer category to CONFIRMED_TEAMMATE -> contact visible with audience notice
    fireEvent.click(screen.getByRole('button', { name: /view as teammate/i }));
    expect(screen.getByText('@alex_discord')).toBeInTheDocument();
  });

  it('rejects non-HTTPS URLs at form level without dispatching network request (US-006-T3)', async () => {
    const fetchSpy = vi.spyOn(authFetchModule, 'authFetch');

    render(<IntegratedProfileManager />);
    fireEvent.click(screen.getByRole('button', { name: /edit profile/i }));

    fireEvent.change(screen.getByLabelText(/portfolio https url 1/i), {
      target: { value: 'http://insecure.test' },
    });

    fireEvent.click(screen.getByRole('button', { name: /save technical profile/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/valid https urls/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
