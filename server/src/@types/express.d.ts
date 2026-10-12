import type { DecodedIdToken } from 'firebase-admin/auth';
import type { Participant } from '../db/types.js';

declare global {
  namespace Express {
    interface Request {
      participant?: Participant;
      firebaseUser?: DecodedIdToken;
    }
  }
}
