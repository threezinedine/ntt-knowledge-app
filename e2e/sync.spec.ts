import type { HubLatest, HubVersion } from '@km/core';
import type { APIRequestContext, Page } from '@playwright/test';
import { expect, hubUrl, openSync, test } from './fixtures';

// The e2e server is both this device's server and the hub it syncs with.

const syncDialog = (page: Page) => page.getByRole('dialog', { name: 'Sync' });
const indicator = (page: Page) =>
  page
    .getByRole('banner')
    .getByRole('button', { name: /^(Sync|Up to date|A newer|Changes|Changed here)/ });

async function connectInUi(page: Page): Promise<void> {
  await page.goto('/');
  await openSync(page);
  const dialog = syncDialog(page);
  await dialog.getByLabel('Hub address').fill(hubUrl());
  await dialog.getByLabel('Name of this device').fill('Desk');
  await dialog.getByRole('button', { name: 'Connect' }).click();
  await expect(dialog.getByText('Not synced yet')).toBeVisible();
}

/**
 * Another device pushes a version: the hub's newest snapshot with one node
 * renamed, as if edited elsewhere.
 */
async function otherDevicePushes(request: APIRequestContext, title: string): Promise<HubVersion> {
  const pair = await request.post('/api/hub/pair', { data: { code: '', name: 'Laptop' } });
  const { token } = (await pair.json()) as { token: string };
  const auth = { authorization: `Bearer ${token}` };
  const latest = (await (
    await request.get('/api/hub/latest', { headers: auth })
  ).json()) as HubLatest;
  const node = latest.snapshot.tables.nodes.find((n) => n.deleted_at === null);
  if (!node) throw new Error('no live node in the hub version');
  node.title = title;
  node.updated_at += 1;
  const res = await request.post('/api/hub/versions', {
    headers: auth,
    data: { baseVersion: latest.head.version, snapshot: latest.snapshot },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as HubVersion;
}

test.describe('sync with a hub', () => {
  test('connect, then push this device as the hub’s newest version', async ({ page, api }) => {
    // The hub already has a version (as it would from another device)...
    await api.publishToHub();
    await page.request.delete('/api/sync'); // ...and this device starts unconnected,
    await api.createNode({ title: 'Synced note' }); // with data of its own.
    await connectInUi(page);
    const dialog = syncDialog(page);
    await expect(dialog.getByText('Has changes that aren’t on the hub')).toBeVisible();
    await dialog.getByRole('button', { name: 'Push' }).click();
    // A device that never pulled can't push over the hub's version unasked.
    await expect(
      dialog.getByRole('heading', { name: 'Overwrite the hub’s newest version?' }),
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Push anyway' }).click();
    await expect(page.locator('.toast', { hasText: 'Pushed' })).toBeVisible();
    await expect(dialog.getByText('No changes since then')).toBeVisible();
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(indicator(page)).toHaveAccessibleName(/^Up to date with the hub/);
  });

  test('a newer version on the hub: warned once on editing, and pushing over it asks first', async ({
    page,
    api,
  }) => {
    const node = await api.createNode({ title: 'Shared' });
    await api.publishToHub();
    const theirs = await otherDevicePushes(page.request, 'Renamed elsewhere');

    await page.goto(`/nodes/${node.id}`);
    await expect(indicator(page)).toHaveAccessibleName(
      `A newer version is on the hub: version ${String(theirs.version)}`,
    );

    // Editing anyway: one warning, the edit still goes through.
    const title = page.getByRole('textbox', { name: 'Title' });
    await title.fill('Mine');
    const warning = page.getByRole('alert').filter({ hasText: 'A newer version' });
    await expect(warning).toBeVisible();
    await warning.getByRole('button', { name: 'Keep editing' }).click();
    await expect(page.getByText('Saved')).toBeVisible();
    await title.fill('Mine again');
    await expect(page.getByText('Saved')).toBeVisible();
    await expect(warning).toHaveCount(0);

    // Pushing over their version asks first.
    await openSync(page);
    const dialog = syncDialog(page);
    await dialog.getByRole('button', { name: 'Push' }).click();
    await expect(
      dialog.getByRole('heading', { name: 'Overwrite the hub’s newest version?' }),
    ).toBeVisible();
    await expect(dialog.getByText(/from Laptop/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Push anyway' }).click();
    await expect(page.locator('.toast', { hasText: 'Pushed' })).toBeVisible();
    await expect(
      dialog.getByText(new RegExp(`Newest: version ${String(theirs.version + 1)} from E2E PC`)),
    ).toBeVisible();
  });

  test('pulling over changes here asks first, then replaces them', async ({ page, api }) => {
    const node = await api.createNode({ title: 'Original' });
    await api.publishToHub();
    await otherDevicePushes(page.request, 'From the laptop');
    await api.createNode({ title: 'Only here' }); // a change the hub doesn't have

    await page.goto('/');
    await openSync(page);
    const dialog = syncDialog(page);
    await dialog.getByRole('button', { name: 'Pull', exact: true }).click();
    await expect(
      dialog.getByRole('heading', { name: 'Replace this device’s changes?' }),
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Pull anyway' }).click();

    await expect(page.locator('.toast', { hasText: 'Pulled version' })).toBeVisible();
    expect((await api.getNode(node.id)).title).toBe('From the laptop');
    const nodes = page.getByRole('navigation', { name: 'Nodes' });
    await expect(nodes.getByRole('link', { name: /From the laptop/ })).toBeVisible();
    await expect(nodes.getByRole('link', { name: /Only here/ })).toHaveCount(0);
    await expect(indicator(page)).toHaveAccessibleName(/^Up to date with the hub/);
  });

  test('a wrong hub address says so', async ({ page }) => {
    await page.goto('/');
    await openSync(page);
    const dialog = syncDialog(page);
    await dialog.getByLabel('Hub address').fill('http://127.0.0.1:9');
    await dialog.getByRole('button', { name: 'Connect' }).click();
    await expect(dialog.getByRole('alert')).toHaveText(/Can’t reach the hub/);
  });
});
