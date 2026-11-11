import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as chat from '../services/chat.js';
import { runCLI } from './backfillTeamChannels.js';

describe('chat:backfill-team-channels command (#431)', () => {
  let log: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;
  const previousExitCode = process.exitCode;

  beforeEach(() => {
    vi.restoreAllMocks();
    log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = previousExitCode;
  });

  it('prints the counts and exits cleanly when nothing failed', async () => {
    vi.spyOn(chat, 'backfillTeamChannels').mockResolvedValue({
      checked: 5,
      created: 3,
      alreadyLinked: 1,
      skipped: 1,
      failed: [],
    });

    await runCLI();

    const output = log.mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toContain('Teams checked:      5');
    expect(output).toContain('Channels created:   3');
    expect(output).toContain('Already had one:    1');
    expect(output).toContain('Skipped (disbanded): 1');
    expect(output).toContain('Failed:             0');
    expect(process.exitCode).toBeUndefined();
    expect(error).not.toHaveBeenCalled();
  });

  it('lists each failed team and sets a failing exit code', async () => {
    vi.spyOn(chat, 'backfillTeamChannels').mockResolvedValue({
      checked: 2,
      created: 1,
      alreadyLinked: 0,
      skipped: 0,
      failed: [{ teamId: 'team-2', reason: 'constraint failed' }],
    });

    await runCLI();

    expect(error).toHaveBeenCalledWith('  - team-2: constraint failed');
    expect(process.exitCode).toBe(1);
  });
});
