import { createHash } from 'node:crypto';

/** @param {Buffer} bytes */
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * Tries each URL in order and returns the first body that matches the checksum.
 * @param {string | string[]} urls
 * @param {string} expected
 */
export async function downloadVerified(urls, expected) {
  const failures = [];
  for (const url of [urls].flat()) {
    try {
      return await downloadOne(url, expected);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
      console.warn(`Download failed, trying the next source: ${failures.at(-1)}`);
    }
  }
  throw new Error(failures.join('\n'));
}

/**
 * @param {string} url
 * @param {string} expected
 */
async function downloadOne(url, expected) {
  console.log(`Downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`failed to download ${url}: HTTP ${response.status} ${response.statusText}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = sha256(bytes);
  if (digest !== expected) {
    throw new Error(`checksum mismatch for ${url}: expected ${expected}, got ${digest}`);
  }
  return bytes;
}
