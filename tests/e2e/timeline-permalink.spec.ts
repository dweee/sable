import { expect, test, SIGNED_OUT } from './fixtures/test';
import { historyItems, timelineItem } from './fixtures/timeline-items';

test('jumps to an event outside the loaded range', async ({
  page,
  app,
  timeline,
  admin,
  deepRoom,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 900 });

  const distantEventId = deepRoom.eventIds[0];
  const distantBody = deepRoom.bodies[0];
  const replyBody = `Answering something older ${String(Date.now())}`;
  await admin.sendMessage(deepRoom.roomId, replyBody, {
    'm.relates_to': { 'm.in_reply_to': { event_id: distantEventId } },
  });

  await app.openRoom(deepRoom.roomId);
  await timeline.expectRevealed();

  const reply = timeline.container
    .locator('.item')
    .filter({ hasText: replyBody })
    .locator('.reply-preview');
  await expect(reply).toBeVisible({ timeout: 20_000 });
  await expect(timeline.itemByEventId(distantEventId)).toHaveCount(0);

  await reply.click();

  await expect.poll(() => new URL(page.url()).searchParams.get('event')).toBe(distantEventId);
  await expect(timeline.itemByEventId(distantEventId)).toBeVisible({ timeout: 30_000 });
  await expect(timeline.message(distantBody)).toBeVisible();
});

test('scrolls forward out of a permalink whose context is shorter than the viewport', async ({
  page,
  app,
  timeline,
  deepRoom,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 900 });

  const target = deepRoom.eventIds[0];
  await app.openPermalink(deepRoom.roomId, target);
  await timeline.expectRevealed({ timeout: 30_000 });
  await expect(timeline.itemByEventId(target)).toBeVisible({ timeout: 30_000 });

  await expect.poll(() => timeline.scrollableHeight(), { timeout: 30_000 }).toBeGreaterThan(0);

  const forward = deepRoom.eventIds[30];
  await timeline.viewport.hover();
  await expect
    .poll(
      async () => {
        if (await timeline.itemByEventId(forward).isVisible()) return true;
        await page.mouse.wheel(0, 900);
        return false;
      },
      { intervals: Array.from({ length: 120 }, () => 250), timeout: 60_000 }
    )
    .toBe(true);
});

test('a repeated reply jump centres the target again', async ({
  page,
  app,
  timeline,
  admin,
  deepRoom,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 900 });

  const distantEventId = deepRoom.eventIds[20];
  const replyBody = `Answering something older ${String(Date.now())}`;
  await admin.sendMessage(deepRoom.roomId, replyBody, {
    'm.relates_to': { 'm.in_reply_to': { event_id: distantEventId } },
  });

  await app.openRoom(deepRoom.roomId);
  await timeline.expectRevealed();

  const reply = timeline.container
    .locator('.item')
    .filter({ hasText: replyBody })
    .locator('.reply-preview');
  await expect(reply).toBeVisible({ timeout: 20_000 });
  await reply.click();
  await expect(timeline.itemByEventId(distantEventId)).toBeVisible({ timeout: 30_000 });

  const offsetFromCentre = async (): Promise<number> => {
    if ((await timeline.itemByEventId(distantEventId).count()) === 0)
      return Number.POSITIVE_INFINITY;
    const row = await timeline.itemByEventId(distantEventId).boundingBox();
    const viewport = await timeline.viewport.boundingBox();
    if (!row || !viewport) return Number.POSITIVE_INFINITY;
    return Math.abs(row.y + row.height / 2 - (viewport.y + viewport.height / 2));
  };
  await expect.poll(offsetFromCentre, { timeout: 10_000 }).toBeLessThan(120);

  await timeline.viewport.hover();
  await expect
    .poll(
      async () => {
        if (await reply.isVisible()) return true;
        await page.mouse.wheel(0, 900);
        return false;
      },
      { intervals: Array.from({ length: 120 }, () => 250), timeout: 60_000 }
    )
    .toBe(true);
  expect(await offsetFromCentre()).toBeGreaterThan(300);

  await reply.click();
  await expect.poll(offsetFromCentre, { timeout: 10_000 }).toBeLessThan(120);
});

test.describe('a repeated permalink whose live target was evicted', () => {
  test.use({ storageState: SIGNED_OUT });
  test('centres the replacement focused subscription for the same URL', async ({
    page,
    app,
    timeline,
    core,
    installRoomCore,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await installRoomCore('ready');
    await app.openRoom('!room:example.test');
    const target = '$general-10:example.test';
    const reply = {
      ...timelineItem('same-target-reply', 'Reply to the retained permalink'),
      in_reply_to: {
        event_id: target,
        sender: '@alice:example.test',
        sender_name: 'Alice',
        sender_mentioned: false,
        body: 'General message 10',
        fallback: null,
      },
    };
    const subscription = await core.subscription();
    await core.emitTimelineDiff(subscription, [{ op: 'push_back', value: reply }]);
    const preview = timeline.itemById(reply.id).locator('.reply-preview');
    await expect(preview).toBeVisible();
    const offset = () =>
      timeline.itemByEventId(target).evaluate((node) => {
        const viewport = node.closest('.viewport');
        if (!viewport) throw new Error('missing reader viewport');
        const row = node.getBoundingClientRect(),
          bounds = viewport.getBoundingClientRect();
        return Math.abs(row.top + row.height / 2 - bounds.top - bounds.height / 2);
      });
    await preview.click();
    await expect.poll(() => new URL(page.url()).searchParams.get('event')).toBe(target);
    await expect.poll(offset).toBeLessThan(120);
    expect(await core.subscribeCount()).toBe(1);
    // Match the real SDK clear/repopulation from the captured full-suite trace:
    // the URL stays put while the live snapshot loses the previously loaded row.
    await core.emitTimelineDiff(subscription, [
      {
        op: 'reset',
        values: [
          ...historyItems({
            idPrefix: 'replacement',
            label: 'Replacement history',
            count: 100,
            timestampBase: 1_699_999_000_000,
          }),
          reply,
        ],
      },
    ]);
    await expect(timeline.itemByEventId(target)).toHaveCount(0);
    await timeline.viewport.hover();
    await page.mouse.wheel(0, 5_000);
    await expect(preview).toBeInViewport();
    await preview.click();
    await expect.poll(() => core.subscribeCount()).toBe(2);
    await expect.poll(offset).toBeLessThan(120);
  });
});
