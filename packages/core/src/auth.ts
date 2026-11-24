/** GET /api/auth/status: always 200, so the web app can decide what to show. */
export interface AuthStatus {
  /** False when the server runs with KM_AUTH=off (local, single-user). */
  enabled: boolean;
  signedIn: boolean;
  /** When this sign-in ends (epoch ms); null when not signed in or auth is off. */
  expiresAt: number | null;
  /** This session may only read (the phone app signs in like this). */
  readOnly: boolean;
}
