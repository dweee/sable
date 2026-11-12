import { expect, test, SIGNED_OUT } from './fixtures/test';

const WIDGET_URL =
  'https://widgets.example.test/dashboard?user=$matrix_user_id&room=$matrix_room_id&name=$matrix_display_name';

function widget(): Record<string, unknown> {
  return { type: 'grafana', url: WIDGET_URL, name: 'Dashboard', data: {} };
}

test('a widget renders in a sandboxed iframe with the room and user substituted', async ({
  page,
  app,
  admin,
}) => {
  const roomId = await admin.createRoom({ name: `Widgets ${String(Date.now())}` });
  await admin.sendMessage(roomId, 'Dashboard lives here.');
  await admin.setWidget(roomId, 'dashboard', widget());

  const toggle = page.getByRole('button', { name: 'Widgets' });
  await app.openRoomShowing(roomId, toggle);
  await toggle.click();

  await expect(page.locator('iframe.widget-frame')).toHaveCount(0);
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();

  const frame = page.locator('iframe.widget-frame');
  await expect(frame).toBeVisible();
  await expect(frame).toHaveAttribute(
    'sandbox',
    'allow-forms allow-pointer-lock allow-popups allow-popups-to-escape-sandbox allow-presentation allow-same-origin allow-scripts allow-downloads allow-modals'
  );

  const url = new URL((await frame.getAttribute('src')) ?? '');
  expect(url.searchParams.get('user')).toBe(admin.userId);
  expect(url.searchParams.get('room')).toBe(roomId);
  expect(url.searchParams.get('widgetId')).toBe('dashboard');

  await page.getByRole('button', { name: 'Back to widgets' }).click();
  await expect(frame).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Remove Dashboard' })).toBeVisible();
});

test('widget removal is hidden without permission to change room settings', async ({
  page,
  app,
  admin,
  guest,
}) => {
  const roomId = await guest.createRoom({
    name: `Guest widgets ${String(Date.now())}`,
    invite: [admin.userId],
  });
  await admin.join(roomId);
  await guest.sendMessage(roomId, 'Dashboard lives here too.');
  await guest.setWidget(roomId, 'dashboard', widget());

  await app.openRoomShowing(roomId, page.getByRole('button', { name: 'Widgets' }));

  await page.getByRole('button', { name: 'Widgets' }).click();
  await expect(page.getByRole('button', { name: 'Dashboard', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove Dashboard' })).toHaveCount(0);
});

test('removing a widget with permission takes it out of the room state', async ({
  page,
  app,
  admin,
}) => {
  const roomId = await admin.createRoom({ name: `Remove widget ${String(Date.now())}` });
  await admin.sendMessage(roomId, 'Dashboard lives here.');
  await admin.setWidget(roomId, 'dashboard', widget());

  await app.openRoomShowing(roomId, page.getByRole('button', { name: 'Widgets' }));

  await page.getByRole('button', { name: 'Widgets' }).click();
  await page.getByRole('button', { name: 'Remove Dashboard' }).click();
  await page
    .getByRole('dialog')
    .filter({ hasText: 'Remove Dashboard?' })
    .getByRole('button', { name: 'Remove Dashboard' })
    .click();

  await expect(page.getByText('This room has no widgets.')).toBeVisible();

  await expect
    .poll(() =>
      admin.request<Record<string, unknown>>(
        'GET',
        `client/v3/rooms/${encodeURIComponent(roomId)}/state/im.vector.modular.widgets/dashboard`
      )
    )
    .toEqual({});
});

test.describe('cached summary before the backend room is ready', () => {
  test.use({ storageState: SIGNED_OUT });
  test('timeline readiness recovers widget management after an unknown room', async ({
    page,
    app,
    timeline,
    installRoomCore,
  }) => {
    await installRoomCore('cold_room_details');
    await app.openRooms();
    await expect(app.roomLink('General')).toBeVisible();
    await page.waitForFunction(() =>
      Object.keys(localStorage).some(
        (key) =>
          key.startsWith('sable.room-list.v2.') &&
          localStorage.getItem(key)?.includes('!room:example.test')
      )
    );
    await app.openRoom('!room:example.test');
    await timeline.expectRevealed();
    await expect(page.getByRole('button', { name: 'Widgets', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Widgets', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Remove Dashboard', exact: true })).toBeVisible();
  });
});
