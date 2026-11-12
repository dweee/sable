// Asserts the same messages stay on screen, not that scrollTop is unchanged: a
// virtualised list renumbers rows constantly, and the text is what a reader sees.

import en from '../../src/locales/en.json' with { type: 'json' };
import { expect, test } from './fixtures/test';
import { solidPng } from './fixtures/png';

test.beforeEach(async ({ page, timeline }) => {
  test.setTimeout(120_000);
  await timeline.trackRebuilds();
  await page.setViewportSize({ width: 1280, height: 420 });
});

test('an edit above the viewport does not move the reader', async ({
  app,
  timeline,
  admin,
  deepRoom,
}) => {
  await app.openRoom(deepRoom.roomId);
  await timeline.expectRevealed();
  await expect.poll(() => timeline.distanceFromBottom()).toBe(0);

  // Away from the end, so this is the anchor's job, not follow-to-bottom.
  const wheelDistance = await timeline.viewport.evaluate((node) => node.clientHeight + 30);
  // The first paint can contain only the newest event while history is still
  // arriving. Require enough real range for this input to leave the end.
  await expect.poll(() => timeline.scrollableHeight()).toBeGreaterThan(wheelDistance);
  await timeline.wheelUp(wheelDistance);
  await expect(timeline.jumpToLatest).toBeVisible();
  await timeline.waitForScrollSettled();

  // Overscan/date-divider rows can change as history expands. Hold the same
  // fully visible Matrix event at its actual screen coordinate instead.
  const anchor = await timeline.fullyVisibleAnchor();
  const before = await timeline.itemById(anchor.itemId).evaluate((node) => {
    const eventId = node.getAttribute('data-event-id');
    if (!eventId) throw new Error('reader message has no Matrix event ID');
    return { eventId, y: (node.firstElementChild ?? node).getBoundingClientRect().top };
  });
  await expect.poll(() => timeline.eventIdAboveViewport()).not.toBeNull();
  const above = await timeline.eventIdAboveViewport();
  if (!above) throw new Error('no rendered row above the reader');

  await admin.editMessage(deepRoom.roomId, above, `Edited ${'and rewrapped '.repeat(12)}`);

  await expect(timeline.container.getByText(/and rewrapped/).first()).toBeVisible({
    timeout: 20_000,
  });
  await expect
    .poll(() =>
      timeline
        .itemByEventId(before.eventId)
        .evaluate((node) => (node.firstElementChild ?? node).getBoundingClientRect().top)
    )
    .toBeCloseTo(before.y, 0);
});

test('a deletion above the viewport does not move the reader', async ({
  app,
  timeline,
  admin,
  deepRoom,
}) => {
  await app.openRoom(deepRoom.roomId);
  await timeline.expectRevealed();
  await expect.poll(() => timeline.distanceFromBottom()).toBe(0);

  const wheelDistance = await timeline.viewport.evaluate((node) => node.clientHeight + 30);
  // The first paint can contain only the newest event while history is still
  // arriving. Require enough real range for this input to leave the end.
  await expect.poll(() => timeline.scrollableHeight()).toBeGreaterThan(wheelDistance);
  await timeline.wheelUp(wheelDistance);
  await expect(timeline.jumpToLatest).toBeVisible();
  await timeline.waitForScrollSettled();

  const anchor = await timeline.fullyVisibleAnchor();
  const before = await timeline.itemById(anchor.itemId).evaluate((node) => {
    const eventId = node.getAttribute('data-event-id');
    if (!eventId) throw new Error('reader message has no Matrix event ID');
    return { eventId, y: (node.firstElementChild ?? node).getBoundingClientRect().top };
  });
  await expect.poll(() => timeline.eventIdAboveViewport()).not.toBeNull();
  const doomed = await timeline.eventIdAboveViewport();
  if (!doomed) throw new Error('no rendered row above the reader');

  await admin.redact(deepRoom.roomId, doomed);

  await expect(timeline.itemByEventId(doomed)).toContainText(en.timeline.redacted, {
    timeout: 20_000,
  });
  // Overscan rows may change as the window is trimmed. Measure the reader's
  // fully visible message instead of the first CSS-visible (overscan) row.
  // SDK resets may renumber item IDs; the Matrix event still names that reader.
  await expect
    .poll(() =>
      timeline
        .itemByEventId(before.eventId)
        .evaluate((node) => (node.firstElementChild ?? node).getBoundingClientRect().top)
    )
    .toBeCloseTo(before.y, 0);
});

test('an image without dimensions takes the file shape without losing the newest message', async ({
  page,
  app,
  timeline,
  admin,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });

  const roomId = await admin.createRoom({ name: `Sizeless image ${String(Date.now())}` });
  const last = `Newest after the image ${String(Date.now())}`;
  const url = await admin.uploadMedia(solidPng(1000, 400), 'image/png', 'wide.png');

  await app.openRoom(roomId);
  await timeline.expectRevealed();

  await admin.sendImage(roomId, url, { body: 'wide.png' });
  await admin.sendMessage(roomId, last);

  await expect(timeline.image).toBeVisible({ timeout: 20_000 });
  await expect(timeline.image.locator('img')).toBeVisible({ timeout: 20_000 });
  const loaded = await timeline.image.boundingBox();
  if (!loaded) throw new Error('missing loaded image box');

  expect(loaded.width / loaded.height).toBeCloseTo(1000 / 400, 1);
  await timeline.expectAtLatest(last);
});
