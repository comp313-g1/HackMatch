import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProfileEditorForm } from './ProfileEditorForm';
import * as authFetchModule from '../../config/authFetch';

describe('ProfileEditorForm (US-006 / #65)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders all US-006 fields, self-declared notices, and teammate audience disclosure', () => {
    render(<ProfileEditorForm />);

    expect(screen.getByLabelText(/display handle/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/primary role/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/academic institution/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/skill tags/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/portfolio https url 1/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/shared contact handle/i)).toBeInTheDocument();
    expect(screen.getAllByText(/self-declared/i).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/visible only to your confirmed teammates/i)).toBeInTheDocument();
  });

  it('shows a field-specific error for a non-HTTPS portfolio URL and preserves all other entered values (US-006 AC 2, AC 5 / T2)', async () => {
    const fetchSpy = vi.spyOn(authFetchModule, 'authFetch');
    render(<ProfileEditorForm />);

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
      target: { value: 'Node.js, TypeScript' },
    });
    fireEvent.change(screen.getByLabelText(/portfolio https url 1/i), {
      target: { value: 'http://insecure.example.com' },
    });

    fireEvent.click(screen.getByRole('button', { name: /save technical profile/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/valid https urls/i);
    expect(fetchSpy).not.toHaveBeenCalled();

    // Verify all other entered values are preserved intact
    expect(screen.getByLabelText(/display handle/i)).toHaveValue('alex_builder');
    expect(screen.getByLabelText(/primary role/i)).toHaveValue('Backend');
    expect(screen.getByLabelText(/academic institution/i)).toHaveValue('Centennial College');
    expect(screen.getByLabelText(/skill tags/i)).toHaveValue('Node.js, TypeScript');
    expect(screen.getByLabelText(/portfolio https url 1/i)).toHaveValue(
      'http://insecure.example.com'
    );
  });

  it('submits valid profile edits via authFetch and shows a confirmation status (US-006 AC 1, AC 5 / T1)', async () => {
    const onSaved = vi.fn();
    const fetchSpy = vi.spyOn(authFetchModule, 'authFetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          message: 'Profile updated successfully.',
          profile: {
            handle: 'alex_builder',
            primaryRole: 'Backend',
            institution: 'Centennial College',
            skills: ['Node.js', 'TypeScript'],
            portfolioLinks: [
              {
                url: 'https://github.com/alex_builder',
                label: 'GitHub',
                isSelfDeclared: true,
              },
            ],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    render(<ProfileEditorForm onSaved={onSaved} />);

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
      target: { value: 'Node.js, TypeScript' },
    });
    fireEvent.change(screen.getByLabelText(/portfolio https url 1/i), {
      target: { value: 'https://github.com/alex_builder' },
    });
    fireEvent.change(screen.getByLabelText(/portfolio label 1/i), {
      target: { value: 'GitHub' },
    });

    fireEvent.click(screen.getByRole('button', { name: /save technical profile/i }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledOnce();
    });

    expect(await screen.findByRole('status')).toHaveTextContent(
      /technical profile updated successfully/i
    );
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it('displays server-returned field errors while preserving entered values', async () => {
    vi.spyOn(authFetchModule, 'authFetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'Handle is already taken.',
          code: 'HANDLE_ALREADY_IN_USE',
          errors: {
            handle: 'This handle is already in use by another participant.',
          },
        }),
        { status: 409, headers: { 'Content-Type': 'application/json' } }
      )
    );

    render(<ProfileEditorForm />);

    fireEvent.change(screen.getByLabelText(/display handle/i), {
      target: { value: 'taken_handle' },
    });
    fireEvent.change(screen.getByLabelText(/academic institution/i), {
      target: { value: 'Centennial College' },
    });

    fireEvent.click(screen.getByRole('button', { name: /save technical profile/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /already in use by another participant/i
    );
    expect(screen.getByLabelText(/display handle/i)).toHaveValue('taken_handle');
    expect(screen.getByLabelText(/academic institution/i)).toHaveValue('Centennial College');
  });

  it('shows a loading state when loadOnMount is true and populates loaded profile values (#66)', async () => {
    let resolveLoad: (value: Response) => void = () => {};
    vi.spyOn(authFetchModule, 'authFetch').mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveLoad = resolve;
      })
    );

    render(<ProfileEditorForm loadOnMount />);

    expect(screen.getByRole('status')).toHaveTextContent(/loading your technical profile/i);

    resolveLoad(
      new Response(
        JSON.stringify({
          profile: {
            handle: 'loaded_dev',
            primaryRole: 'Mobile',
            institution: 'University of Waterloo',
            skills: ['Kotlin', 'Swift'],
            portfolioLinks: [{ url: 'https://github.com/loaded_dev', label: 'GitHub' }],
            sharedContactHandle: '@loaded_contact',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    expect(await screen.findByLabelText(/display handle/i)).toHaveValue('loaded_dev');
    expect(screen.getByLabelText(/primary role/i)).toHaveValue('Mobile');
    expect(screen.getByLabelText(/academic institution/i)).toHaveValue('University of Waterloo');
    expect(screen.getByLabelText(/skill tags/i)).toHaveValue('Kotlin, Swift');
    expect(screen.getByLabelText(/portfolio https url 1/i)).toHaveValue(
      'https://github.com/loaded_dev'
    );
  });

  it('shows an empty-profile notice when loaded profile has no saved fields and allows retry on load failure (#66)', async () => {
    const fetchSpy = vi
      .spyOn(authFetchModule, 'authFetch')
      .mockRejectedValueOnce(new Error('Network down'))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            profile: {
              handle: null,
              primaryRole: null,
              institution: null,
              skills: [],
              portfolioLinks: [],
              sharedContactHandle: null,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

    render(<ProfileEditorForm loadOnMount />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /network error while loading your technical profile/i
    );

    fireEvent.click(screen.getByRole('button', { name: /retry loading profile/i }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      /your technical profile has no saved details yet/i
    );
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
