/**
 * Dev helper: mark a Firebase Auth user as emailVerified.
 * Usage: npx tsx src/scripts/forceVerifyEmail.ts you@example.com
 */
import { firebaseAuth } from '../config/firebase.js';

async function main(): Promise<void> {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    console.error('Usage: npx tsx src/scripts/forceVerifyEmail.ts <email>');
    process.exit(1);
  }

  const before = await firebaseAuth.getUserByEmail(email);
  console.log('before', { uid: before.uid, email: before.email, emailVerified: before.emailVerified });

  await firebaseAuth.updateUser(before.uid, { emailVerified: true });

  const after = await firebaseAuth.getUser(before.uid);
  console.log('after', { uid: after.uid, email: after.email, emailVerified: after.emailVerified });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
