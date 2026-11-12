import { expect, test, SIGNED_OUT } from './fixtures/test';
import { historyItems } from './fixtures/timeline-items';
test.use({ storageState: SIGNED_OUT });

test('real wheel input leaves a nested vertical scroller in control', async ({
  page,
  app,
  timeline,
  core,
  installRoomCore,
}) => {
  await installRoomCore('ready');
  await app.openRoom('!room:example.test');
  await core.emitTimelineDiff(await core.subscription(), [
    {
      op: 'reset',
      values: historyItems({
        idPrefix: 'nested',
        label: 'Nested history',
        count: 80,
        timestampBase: 1_699_999_000_000,
      }),
    },
  ]);
  await expect.poll(() => timeline.scrollableHeight()).toBeGreaterThan(500);
  await timeline.scrollToBottomAndNotify();
  await timeline.waitForScrollSettled();
  const anchor = await timeline.fullyVisibleAnchor();
  await timeline.itemById(anchor.itemId).evaluate((row) => {
    const nested = document.createElement('div');
    nested.dataset.testNestedScroll = '';
    nested.style.cssText = 'height:80px;overflow-y:auto;';
    const content = document.createElement('div');
    content.style.height = '1000px';
    content.textContent = 'Scrollable message content';
    nested.append(content);
    row.append(nested);
  });
  const nested = page.locator('[data-test-nested-scroll]');
  await nested.scrollIntoViewIfNeeded();
  await timeline.waitForScrollSettled();
  const before = await timeline.scrollTop();
  const reader = await timeline.fullyVisibleAnchor();
  await nested.hover();
  await page.mouse.wheel(0, 120);
  await expect.poll(() => nested.evaluate((node) => node.scrollTop)).toBe(120);
  expect(await timeline.scrollTop()).toBe(before);
  await timeline.expectAnchorHeld(reader);
});
