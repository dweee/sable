import { expect, test } from '@playwright/test';
import { cloneableStorageState } from './fixtures/session-snapshot';

test('a cloned session preserves source encryption and restores typed session bytes', async ({
  browser,
  baseURL,
}) => {
  if (!baseURL) throw new Error('The session snapshot test requires the application origin');
  const source = await browser.newContext();
  const page = await source.newPage();
  const url = `${new URL(baseURL).origin}/__sable_e2e_snapshot_contract__`;
  await page.route(url, (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html>' })
  );
  await page.goto(url);
  try {
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('sable-next-session', 1);
        request.onupgradeneeded = () => {
          request.result.createObjectStore('session');
        };
        request.onsuccess = () => {
          resolve(request.result);
        };
        request.onerror = () => {
          reject(request.error ?? new Error('IndexedDB request failed'));
        };
      });
      const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
        'encrypt',
        'decrypt',
      ]);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const data = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        new Uint8Array([1, 2, 3])
      );
      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = db.transaction('session', 'readwrite');
          transaction.objectStore('session').put(key, 'sealing-key');
          transaction.objectStore('session').put({ iv, data }, 'current');
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
    });
    const state = await cloneableStorageState(browser, page);
    const original = await page.evaluate(async () => {
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
        const read = (name: string): Promise<unknown> =>
          new Promise((resolve, reject) => {
            const request = store.get(name);
            request.onsuccess = () => {
              resolve(request.result as unknown);
            };
            request.onerror = () => {
              reject(request.error ?? new Error('IndexedDB request failed'));
            };
          });
        const [key, value] = await Promise.all([read('sealing-key'), read('current')]);
        return {
          keyIsNonExtractable: key instanceof CryptoKey && !key.extractable,
          sessionIsSealed:
            typeof value === 'object' && value !== null && 'iv' in value && 'data' in value,
        };
      } finally {
        db.close();
      }
    });
    expect(original).toEqual({ keyIsNonExtractable: true, sessionIsSealed: true });
    const restored = await browser.newContext({ storageState: state });
    try {
      const snapshot = await restored.newPage();
      await snapshot.route(url, (route) =>
        route.fulfill({ contentType: 'text/html', body: '<!doctype html>' })
      );
      await snapshot.goto(url);
      const restoredRecords = await snapshot.evaluate(async () => {
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
          const read = (name: string): Promise<unknown> =>
            new Promise((resolve, reject) => {
              const request = store.get(name);
              request.onsuccess = () => {
                resolve(request.result as unknown);
              };
              request.onerror = () => {
                reject(request.error ?? new Error('IndexedDB request failed'));
              };
            });
          const [key, value] = await Promise.all([read('sealing-key'), read('current')]);
          return {
            noBrokenKey: key === undefined,
            bytes: value instanceof Uint8Array ? Array.from(value) : null,
          };
        } finally {
          db.close();
        }
      });
      expect(restoredRecords).toEqual({ noBrokenKey: true, bytes: [1, 2, 3] });
    } finally {
      await restored.close();
    }
  } finally {
    await source.close();
  }
});
