import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { backfillTeamChannels } from '../services/chat.js';

/**
 * One-time operator command (#431): creates the private chat channel for every active team that
 * does not have one yet. Idempotent; run it as often as needed.
 *
 *   npm run chat:backfill-team-channels
 */
export async function runCLI(): Promise<void> {
  const result = await backfillTeamChannels();
  console.log('[Team Chat Backfill] Done.');
  console.log(`  Teams checked:      ${result.checked}`);
  console.log(`  Channels created:   ${result.created}`);
  console.log(`  Already had one:    ${result.alreadyLinked}`);
  console.log(`  Skipped (disbanded): ${result.skipped}`);
  console.log(`  Failed:             ${result.failed.length}`);
  for (const f of result.failed) console.error(`  - ${f.teamId}: ${f.reason}`);
  if (result.failed.length > 0) process.exitCode = 1;
}

const isDirectExecution =
  Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectExecution) {
  /* v8 ignore next 4 */
  runCLI().catch((err) => {
    console.error('[Team Chat Backfill Error]', err);
    process.exit(1);
  });
}
