/* eslint-disable no-console -- a terminal tool: printing is its job */
/**
 * `npm run auth:setup`: creates the authenticator secret, shows it as a QR
 * code to scan with Google Authenticator (or any TOTP app), checks one code,
 * then writes KM_TOTP_SECRET and KM_AUTH=totp to the repo-root .env.
 *
 * The secret only ever appears in this terminal and in .env, never on the web.
 *
 *   npm run auth:setup            first time
 *   npm run auth:setup -- --show  show the QR again (e.g. for a new phone)
 *   npm run auth:setup -- --new   replace the secret (old app entries stop working)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { parseEnv } from 'node:util';
import QRCode from 'qrcode';
import { base32Decode, matchingStep, newTotpSecret, otpauthUri } from '../auth/totp.js';
import { DEFAULT_ENV_FILE, envPath, setEnvValues } from '../envFile.js';

const file = envPath(process.env.KM_ENV_FILE ?? DEFAULT_ENV_FILE);
const args = new Set(process.argv.slice(2));
const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
const existing = parseEnv(text).KM_TOTP_SECRET?.trim() ?? '';

if (existing && !args.has('--show') && !args.has('--new')) {
  console.log(`An authenticator secret is already set in ${file}.`);
  console.log('  --show  show its QR code again (e.g. to add it to a new phone)');
  console.log('  --new   replace it (codes from the old app entry stop working)');
  process.exit(0);
}

const showing = existing !== '' && args.has('--show');
const secret = showing ? existing : newTotpSecret();
// A fixed label: the authenticator may back entries up to the cloud.
const uri = otpauthUri(secret, 'owner');

console.log('\nScan this with Google Authenticator (+ → Scan a QR code):\n');
console.log(await QRCode.toString(uri, { type: 'terminal', small: true }));
console.log('Can\'t scan? Choose "Enter a setup key" and type:');
console.log(`  ${secret.replace(/(.{4})/g, '$1 ').trim()}   (time-based)\n`);

if (showing) process.exit(0);

// Only switch sign-in on once a code checks out, so a missed scan can't lock you out.
if (process.stdin.isTTY) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  for (;;) {
    const code = (await rl.question('Enter the 6-digit code the app shows now: ')).trim();
    if (matchingStep(base32Decode(secret), code, Date.now()) !== null) break;
    console.log("That code does not match. Check the phone's clock is automatic, and try again.");
  }
  rl.close();
} else {
  console.log('(No terminal to type a code into: skipping the check.)');
}

writeFileSync(file, setEnvValues(text, { KM_AUTH: 'totp', KM_TOTP_SECRET: secret }));
console.log(`\nSaved to ${file} (gitignored). Sign-in is on: restart the server.`);
