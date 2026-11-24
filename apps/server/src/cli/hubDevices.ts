/* eslint-disable no-console -- a terminal tool: printing is its job */
/**
 * `npm run hub:devices`: the devices paired with this hub, and removing one
 * (a lost phone, an old PC). A removed device's token stops working at once;
 * it can pair again with a new code. Terminal only, like restore.
 *
 *   npm run hub:devices                     list them (number, name, kind, paired)
 *   npm run hub:devices -- --revoke 2       remove number 2 from the list (or pass its id)
 *
 * Safe while the server runs (SQLite waits for its turn to write).
 */
import { newId } from '@km/core';
import { loadConfig } from '../config.js';
import { openDatabase } from '../db/database.js';
import { DEFAULT_ENV_FILE, loadEnvFile } from '../envFile.js';
import { createHubRepository } from '../repositories/hubRepository.js';

loadEnvFile(process.env.KM_ENV_FILE ?? DEFAULT_ENV_FILE);
const config = loadConfig(process.env);
const db = openDatabase(config.KM_DB_PATH);
try {
  const hub = createHubRepository({ db, now: Date.now, newId });
  const devices = hub.devices();
  const args = process.argv.slice(2);
  const at = args.indexOf('--revoke');
  if (at === -1) {
    if (devices.length === 0) console.log('\nNo devices are paired with this hub.\n');
    else {
      console.log('\nDevices paired with this hub:\n');
      devices.forEach((d, i) => {
        const kind = d.readOnly ? 'phone (pull only)' : 'device';
        const when = new Date(d.createdAt).toISOString().slice(0, 16).replace('T', ' ');
        console.log(
          `  ${String(i + 1).padStart(2)}. ${d.name}  [${kind}, paired ${when}]  ${d.id}`,
        );
      });
      console.log('\nRemove one: npm run hub:devices -- --revoke <number or id>\n');
    }
  } else {
    const which = args[at + 1] ?? '';
    const byNumber = /^\d+$/.test(which) ? devices[Number(which) - 1] : undefined;
    const device = byNumber ?? devices.find((d) => d.id === which);
    if (!device || !hub.revoke(device.id)) {
      console.error(`\nNo paired device "${which}". Run npm run hub:devices to list them.\n`);
      process.exitCode = 1;
    } else {
      console.log(`\nRemoved "${device.name}": its token no longer works.\n`);
    }
  }
} finally {
  db.close();
}
