import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parse } from 'yaml';
import { packageFlavor } from '../../electron/package-flavor.mjs';

const root = new URL('../../', import.meta.url);
const config = (name) => parse(readFileSync(new URL(`electron/${name}`, root), 'utf8'));

test('fork desktop packaging keeps the separate v2 identity and disables native self updates', () => {
  const flavor = packageFlavor('fork');
  const fork = config(flavor.config);
  assert.equal(flavor.identifier, 'moe.sable.next');
  assert.equal(fork.appId, flavor.identifier);
  assert.equal(fork.extraMetadata.autoUpdate, false);
  assert.equal(fork.extraMetadata.desktopName, 'moe.sable.next.desktop');
  assert.deepEqual(fork.protocols[0].schemes, ['moe.sable.next', 'matrix']);
  assert.equal(fork.linux.executableName, 'sable-next');
  assert.equal(fork.deb.packageName, 'sable-next');
  assert.equal(fork.rpm.packageName, 'sable-next');
  assert.throws(() => packageFlavor('fork', true), /no approved sandboxed identity/);
});

test('retained upstream stable, nightly and sandboxed flavors keep their existing identities', () => {
  assert.deepEqual(packageFlavor('stable'), {
    config: 'electron-builder.stable.yml',
    identifier: 'moe.sable.client',
  });
  assert.deepEqual(packageFlavor('nightly'), {
    config: 'electron-builder.nightly.yml',
    identifier: 'moe.sable.next.nightly',
  });
  assert.deepEqual(packageFlavor(undefined), packageFlavor('fork'));
  assert.deepEqual(packageFlavor('stable', true), {
    config: 'electron-builder.sandboxed.yml',
    identifier: 'moe.sable.client.sandboxed',
  });
});
