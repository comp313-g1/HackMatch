import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { firebaseAuth } from '../config/firebase.js';
import {
  provisionAdminParticipant,
  participantsRepository,
} from '../db/participants.repository.js';
import type { Participant } from '../db/types.js';

export interface ProvisionAdminOptions {
  email: string;
  uid?: string;
  fullName?: string;
  role?: 'ADMIN' | 'PART';
}

export interface ProvisionAdminResult {
  uid: string;
  email: string;
  role: 'ADMIN' | 'PART';
  participant?: Participant | null;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Out-of-band operator administration provisioning utility.
 * Fulfills US-001 AC 4:
 * "administrator provisioning is restricted to an authorized deployment operator,
 * who sets the ADMIN role as a Firebase custom claim."
 */
export async function provisionAdmin(
  options: ProvisionAdminOptions
): Promise<ProvisionAdminResult> {
  if (!options || typeof options !== 'object') {
    throw new Error('ProvisioningError: Options object is required.');
  }

  const rawEmail = options.email;
  if (!rawEmail || typeof rawEmail !== 'string' || !EMAIL_REGEX.test(rawEmail.trim())) {
    throw new Error('ProvisioningError: A valid email address is required.');
  }

  const email = rawEmail.trim().toLowerCase();
  const targetRole = options.role === 'PART' ? 'PART' : 'ADMIN';
  const fullName = options.fullName?.trim() || 'Administrator';

  // 1. Resolve Firebase UID
  let resolvedUid = options.uid?.trim();
  if (!resolvedUid) {
    try {
      const userRecord = await firebaseAuth.getUserByEmail(email);
      resolvedUid = userRecord.uid;
    } catch {
      throw new Error(
        `ProvisioningError: User with email "${email}" not found in Firebase Authentication. Create or register the user first.`
      );
    }
  }

  // 2. Set Firebase Custom Claims
  await firebaseAuth.setCustomUserClaims(resolvedUid, { role: targetRole });

  // 3. Verify Custom Claims persistence
  const updatedUser = await firebaseAuth.getUser(resolvedUid);
  const assignedRole = (updatedUser?.customClaims as Record<string, unknown> | undefined)?.role;
  if (assignedRole !== targetRole) {
    throw new Error(
      `ProvisioningError: Failed to verify custom claims on Firebase user ${resolvedUid}. Expected role "${targetRole}", found "${String(assignedRole)}".`
    );
  }

  // 4. Update or insert Supabase Participant profile
  let participant: Participant | null = null;
  if (targetRole === 'ADMIN') {
    participant = await provisionAdminParticipant({
      firebase_uid: resolvedUid,
      email,
      full_name: fullName,
    });
  } else {
    const existing = await participantsRepository.findByFirebaseUid(resolvedUid);
    if (existing) {
      participant = await participantsRepository.updateParticipant(existing.id, {
        role: 'PART',
      });
    }
  }

  return {
    uid: resolvedUid,
    email,
    role: targetRole,
    participant,
  };
}

/**
 * Parses CLI command-line arguments and runs the operator workflow.
 */
export async function runCLI(args: string[] = process.argv.slice(2)): Promise<void> {
  const parsedArgs: Record<string, string | boolean> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (key === 'demote') {
        parsedArgs.demote = true;
      } else if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        parsedArgs[key] = args[i + 1];
        i++;
      } else {
        parsedArgs[key] = true;
      }
    }
  }

  const email = typeof parsedArgs.email === 'string' ? parsedArgs.email : '';
  const uid = typeof parsedArgs.uid === 'string' ? parsedArgs.uid : undefined;
  const fullName = typeof parsedArgs.name === 'string' ? parsedArgs.name : undefined;
  const role = parsedArgs.demote || parsedArgs.role === 'PART' ? 'PART' : 'ADMIN';

  if (!email) {
    console.error('Usage: npm run admin:provision -- --email <email> [--uid <uid>] [--name <fullName>] [--demote]');
    process.exit(1);
  }

  try {
    const result = await provisionAdmin({ email, uid, fullName, role });
    console.log(`[Admin Provisioning] Successfully ${role === 'ADMIN' ? 'provisioned' : 'demoted'} user:`);
    console.log(`  UID:   ${result.uid}`);
    console.log(`  Email: ${result.email}`);
    console.log(`  Role:  ${result.role}`);
  } catch (error) {
    console.error(`[Admin Provisioning Error] ${(error as Error).message}`);
    process.exit(1);
  }
}

// Cross-platform ESM direct execution detection
const isDirectExecution =
  Boolean(process.argv[1]) &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectExecution) {
  /* v8 ignore next 3 */
  runCLI().catch((err) => {
    console.error('[Admin Provisioning Error]', err);
    process.exit(1);
  });
}
