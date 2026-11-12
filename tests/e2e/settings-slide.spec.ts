import type { Page } from '@playwright/test';

import { expect, test, SIGNED_OUT } from './fixtures/test';

test.use({
  storageState: SIGNED_OUT,
  hasTouch: true,
  viewport: { width: 412, height: 915 },
  contextOptions: { reducedMotion: 'no-preference' },
});

function pageOffsets(page: Page, throughRelease = false): Promise<number[]> {
  return page.evaluate(
    (throughRelease) =>
      new Promise<number[]>((resolve) => {
        const offsets: number[] = [];
        const initial = document.querySelector('.settings-content');
        const initialOffset = initial
          ? new DOMMatrix(getComputedStyle(initial).transform).m41
          : undefined;
        let started: number | undefined;
        let released: number | undefined;
        if (throughRelease) {
          document.addEventListener(
            'touchend',
            () => {
              released = performance.now();
            },
            { once: true, capture: true }
          );
        }
        const deadline = performance.now() + 5000;
        const sample = () => {
          const section = document.querySelector('.settings-content');
          const offset = section ? new DOMMatrix(getComputedStyle(section).transform).m41 : NaN;
          if (
            section &&
            (throughRelease || initialOffset === undefined || offset !== initialOffset)
          ) {
            started ??= performance.now();
          }
          if (started !== undefined) {
            offsets.push(offset);
          }
          const now = performance.now();
          if (
            now < deadline &&
            (started === undefined ||
              (throughRelease
                ? released === undefined || now - released < 600
                : now - started < 600))
          ) {
            requestAnimationFrame(sample);
          } else resolve(offsets);
        };
        requestAnimationFrame(sample);
      }),
    throughRelease
  );
}

async function swipeRight(page: Page, fromX: number, toX: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const y = 400;
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: fromX, y }],
  });
  for (let x = fromX + 12; x <= toX; x += 12) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function settled(page: Page): Promise<void> {
  await page.waitForFunction(
    () => document.querySelector('.dialog-content-settings')?.getAnimations().length === 0
  );
}

function slid(offsets: number[], width: number): boolean {
  return offsets.some((offset) => offset > 1 && offset < width - 1);
}

test('mobile: a settings section slides in over the list and the back arrow slides it out', async ({
  page,
  installRoomCore,
  browserName,
}) => {
  test.skip(browserName === 'webkit', 'WebKit closes the page opening settings with motion on');
  await installRoomCore('ready');
  await page.goto('/settings');
  await expect(page.getByRole('navigation', { name: 'Settings sections' })).toBeVisible();
  await expect(page.locator('.settings-content')).toHaveCount(0);
  await settled(page);
  const width = page.viewportSize()?.width ?? 0;

  const opening = pageOffsets(page);
  await page.getByRole('link', { name: 'Timeline' }).click();
  expect(slid(await opening, width)).toBe(true);
  await expect(page).toHaveURL(/\/settings\/timeline$/);

  const closing = pageOffsets(page);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  expect(slid(await closing, width)).toBe(true);
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.locator('.settings-content')).toHaveCount(0);
});

test('mobile: a released swipe slides the section off instead of dropping it', async ({
  page,
  installRoomCore,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'CDP touch input');
  await installRoomCore('ready');
  await page.goto('/settings/timeline');
  await expect(page.getByRole('button', { name: 'Timeline', exact: true })).toBeVisible();
  await settled(page);
  const width = page.viewportSize()?.width ?? 0;

  const sampling = pageOffsets(page, true);
  await swipeRight(page, 40, 300);
  const offsets = await sampling;
  expect(offsets.some((offset) => offset > 300 && offset < width - 1)).toBe(true);
  await expect(page).toHaveURL(/\/settings$/);
});
