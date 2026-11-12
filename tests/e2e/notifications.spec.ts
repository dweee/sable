import type { Page } from '@playwright/test';
import en from '../../src/locales/en.json' with { type: 'json' };
import { expect, test, GUEST_DISPLAY_NAME } from './fixtures/test';

type Raised = { title: string; body: string; tag: string };

declare global {
  interface Window {
    __e2eNotifications: Raised[];
  }
}

async function stubNotifications(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const raised: Raised[] = [];
    Object.defineProperty(window, '__e2eNotifications', { configurable: true, value: raised });

    function StubNotification(
      this: { addEventListener: () => void; close: () => void },
      title: string,
      options: { body?: string; tag?: string } = {}
    ) {
      raised.push({ title, body: options.body ?? '', tag: options.tag ?? '' });
      this.addEventListener = () => {};
      this.close = () => {};
    }
    // The app may use the registration API when its service worker is ready.
    // Intercept both browser delivery paths; overriding Notification.permission
    // alone does not grant native service-worker notification permission.
    if (typeof ServiceWorkerRegistration !== 'undefined') {
      Object.defineProperty(ServiceWorkerRegistration.prototype, 'showNotification', {
        configurable: true,
        value: (title: string, options: NotificationOptions = {}): Promise<void> => {
          raised.push({ title, body: options.body ?? '', tag: options.tag ?? '' });
          return Promise.resolve();
        },
      });
    }

    StubNotification.permission = 'granted';
    StubNotification.requestPermission = () => Promise.resolve('granted');

    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: StubNotification,
    });
  });
}

async function setSwitch(page: Page, label: string, checked: boolean): Promise<void> {
  await page.goto('/settings/notifications');
  const toggle = page.getByRole('switch', { name: label });
  await expect(toggle).toBeVisible({ timeout: 20_000 });
  const state = String(checked);
  if ((await toggle.getAttribute('aria-checked')) !== state) await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', state);
}

test.beforeEach(async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await stubNotifications(page);
});

for (const opened of [false, true]) {
  test(`shows ordinary channel messages in browser notifications and the inbox (opened: ${String(opened)})`, async ({
    page,
    app,
    admin,
    guest,
  }) => {
    test.fixme(
      !opened,
      'The test homeserver does not resolve $ME/$LAZY membership selectors in sliding sync.'
    );
    const roomName = `Notified ${String(Date.now())}`;
    const roomId = await guest.createRoom({
      name: roomName,
      preset: 'public_chat',
      visibility: 'public',
    });
    await admin.join(roomId);
    await admin.sendMessage(roomId, 'Channel opened');
    // A room-wide rule also notifies recent creation and membership state
    // replayed from the worker's sealed initial sync. This contract is ordinary
    // messages, so match their type at the push-rule source, including replay.
    await admin.request('PUT', `client/v3/pushrules/global/override/e2e-channel-messages`, {
      conditions: [
        { kind: 'event_match', key: 'room_id', pattern: roomId },
        { kind: 'event_match', key: 'type', pattern: 'm.room.message' },
      ],
      actions: ['notify'],
    });

    await app.openRooms();
    if (opened) {
      await app.openRoom(roomId);
      await expect(app.composer).toBeVisible();
    }
    await setSwitch(page, en.settings.systemNotifications, true);
    await setSwitch(page, en.settings.notificationContent, true);
    await app.openRooms();
    await page.reload();
    await expect(app.primaryNavigation).toBeVisible();
    await expect(page.locator(`a[href="/rooms/${roomId}"]`)).toBeVisible({ timeout: 30_000 });

    const body = `shipped the patch ${String(Date.now())}`;
    const eventId = await guest.sendMessage(roomId, body);

    await expect
      .poll(() => page.evaluate(() => window.__e2eNotifications), { timeout: 40_000 })
      .toEqual([
        {
          title: roomName,
          body: `${GUEST_DISPLAY_NAME}: ${body}`,
          tag: `${admin.userId} ${roomId}:${eventId}`,
        },
      ]);

    await page.goto('/inbox');
    const entry = page
      .getByRole('region', { name: 'Notifications' })
      .getByRole('listitem')
      .filter({ hasText: body });
    await expect(entry.getByRole('link', { name: roomName })).toBeVisible();
  });
}

test('stays quiet until the switch is on', async ({ page, app, admin, guest }) => {
  const roomName = `Quiet ${String(Date.now())}`;
  const roomId = await guest.createRoom({ name: roomName, invite: [admin.userId] });
  await admin.join(roomId);
  await admin.sendMessage(roomId, 'Channel opened');

  await setSwitch(page, en.settings.systemNotifications, false);
  await app.openRooms();
  await app.openRoom(roomId);
  await expect(app.composer).toBeVisible();
  await app.openRooms();

  await guest.sendMessage(roomId, `unheard ${String(Date.now())}`, {
    'm.mentions': { user_ids: [admin.userId] },
  });

  await expect(app.roomLink(roomName)).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.__e2eNotifications), { timeout: 10_000 })
    .toEqual([]);
});
