import { z } from 'zod';

/** GET /api/auth/status: always 200, so the web app can decide what to show. */
export interface AuthStatus {
  /** False when the server runs with KM_AUTH=off (local, single-user). */
  enabled: boolean;
  signedIn: boolean;
  /** When this sign-in ends (epoch ms); null when not signed in or auth is off. */
  expiresAt: number | null;
}

/** POST /api/auth/login: the 6-digit code from the authenticator app. */
export const loginInputSchema = z.strictObject({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Expected the 6-digit code'),
});
export type LoginInput = z.infer<typeof loginInputSchema>;
