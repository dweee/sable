import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { gitEnvironment, lockedSdk, prepareMirror } from './prepare-cargo-sdk.mjs';

const sdk = 'https://git.sable.moe/SableClient/matrix-rust-sdk';
const revision = 'f609388c27bd03ad0234c266bde8f778faacc600';
const lock = (rev = revision, actual = rev) => `source = "git+${sdk}?rev=${rev}#${actual}"`;

test('accepts one exact SDK revision across locked packages', () => {
  assert.deepEqual(lockedSdk(`${lock()}\n${lock()}`), { url: sdk, revision });
});

test('rejects missing, ambiguous and mismatched locked SDK commits', () => {
  assert.throws(() => lockedSdk(''));
  assert.throws(() => lockedSdk(lock(revision, 'a'.repeat(40))));
  assert.throws(() => lockedSdk(`${lock()}\n${lock('a'.repeat(40))}`));
});

test('appends Git config without replacing inherited entries', () => {
  const values = gitEnvironment({ url: sdk }, '/tmp/sdk mirror', '2');
  assert.equal(values.GIT_CONFIG_COUNT, '3');
  assert.equal(values.GIT_CONFIG_VALUE_2, sdk);
  assert.match(values.GIT_CONFIG_KEY_2, /sdk%20mirror/);
  assert.equal(values.GIT_CONFIG_KEY_0, undefined);
  assert.throws(() => gitEnvironment({ url: sdk }, '/tmp/sdk', '-1'));
});

test('a no-longer-advertised commit is fetched and advertised by exact identity', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sable-sdk-test-'));
  const git = (args, options = {}) =>
    execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
  try {
    const upstream = join(directory, 'upstream');
    git(['init', '--quiet', '--initial-branch=fixture', upstream]);
    git([
      '-C',
      upstream,
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '--allow-empty',
      '--quiet',
      '-m',
      'pinned',
    ]);
    const pinned = git(['-C', upstream, 'rev-parse', 'HEAD']).trim();
    git(['-C', upstream, 'checkout', '--orphan', 'replacement']);
    git([
      '-C',
      upstream,
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '--allow-empty',
      '--quiet',
      '-m',
      'new upstream head',
    ]);
    git(['-C', upstream, 'branch', '-D', 'fixture']);
    const source = { url: pathToFileURL(upstream).href, revision: pinned };
    const mirror = prepareMirror(source, directory);
    assert.equal(git(['-C', mirror, 'rev-parse', 'HEAD']).trim(), pinned);
    assert.match(git(['-C', mirror, 'show-ref']), new RegExp(pinned));
    assert.throws(() => prepareMirror({ ...source, revision: 'f'.repeat(40) }, directory));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
