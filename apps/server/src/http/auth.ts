import { LoginGuard } from '../auth/loginGuard.js';

export interface AuthOptions {
  /** The authenticator secret (raw bytes, decoded from KM_TOTP_SECRET). */
  totpSecret: Buffer;
}

/**
 * Pairing a device with the hub takes the 6-digit code from the owner's
 * authenticator app (TOTP); wrong codes are rationed (loginGuard.ts). With
 * `auth` undefined (KM_AUTH=off) anyone who reaches the hub may pair.
 *
 * There is no browser sign-in any more: the data lives on each device, and
 * the hub only answers devices holding a token (hubRoutes.ts).
 */
export function createLoginGuard(
  auth: AuthOptions | undefined,
  now: () => number,
): LoginGuard | undefined {
  return auth ? new LoginGuard(auth.totpSecret, now) : undefined;
}
