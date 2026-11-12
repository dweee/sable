import type { Browser, BrowserContext, Page } from '@playwright/test';

type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;

// Playwright serializes CryptoKey as {}, so it cannot clone a sealed session.
// Only these disposable E2E snapshots carry plaintext session bytes. The source
// context keeps its non-extractable key and ciphertext; a restored app generates
// a new non-extractable key and reseals the bytes through its normal load path.
export async function cloneableStorageState(browser: Browser, page: Page): Promise<StorageState> {
  const session = await page.evaluate(async () => {
    if (!(await indexedDB.databases()).some((db) => db.name === 'sable-next-session')) return null;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('sable-next-session');
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(request.error ?? new Error('IndexedDB request failed'));
      };
    });
    try {
      const store = db.transaction('session', 'readonly').objectStore('session');
      const read = (key: string): Promise<unknown> =>
        new Promise((resolve, reject) => {
          const request = store.get(key);
          request.onsuccess = () => {
            resolve(request.result as unknown);
          };
          request.onerror = () => {
            reject(request.error ?? new Error('IndexedDB request failed'));
          };
        });
      const [value, key] = await Promise.all([read('current'), read('sealing-key')]);
      if (
        typeof value !== 'object' ||
        value === null ||
        !('iv' in value) ||
        !('data' in value) ||
        !(value.iv instanceof Uint8Array) ||
        !(value.data instanceof ArrayBuffer)
      ) {
        return null;
      }
      if (!(key instanceof CryptoKey))
        throw new Error('Cannot snapshot a sealed session without its key');
      const bytes = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(value.iv) },
        key,
        value.data
      );
      return { origin: location.origin, bytes: Array.from(new Uint8Array(bytes)) };
    } finally {
      db.close();
    }
  });
  const state = await page.context().storageState({ indexedDB: true });
  if (!session) return state;

  // Normalize a separate context on a blank same-origin page. No app worker
  // runs there, and no production key or database in the source context changes.
  const snapshotContext = await browser.newContext({ storageState: state });
  try {
    const snapshotPage = await snapshotContext.newPage();
    const url = `${session.origin}/__sable_e2e_session_snapshot__`;
    await snapshotPage.route(url, (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>E2E snapshot</title>',
      })
    );
    await snapshotPage.goto(url);
    await snapshotPage.evaluate(async (bytes) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('sable-next-session');
        request.onsuccess = () => {
          resolve(request.result);
        };
        request.onerror = () => {
          reject(request.error ?? new Error('IndexedDB request failed'));
        };
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = db.transaction('session', 'readwrite');
          const store = transaction.objectStore('session');
          store.put(new Uint8Array(bytes), 'current');
          store.delete('sealing-key');
          transaction.oncomplete = () => {
            resolve();
          };
          transaction.onerror = () => {
            reject(transaction.error ?? new Error('IndexedDB transaction failed'));
          };
          transaction.onabort = () => {
            reject(transaction.error ?? new Error('IndexedDB transaction failed'));
          };
        });
      } finally {
        db.close();
      }
    }, session.bytes);
    return await snapshotContext.storageState({ indexedDB: true });
  } finally {
    await snapshotContext.close();
  }
}
