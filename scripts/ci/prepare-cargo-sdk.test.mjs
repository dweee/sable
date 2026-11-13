import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { gitEnvironment, lockedSdk, persistCargoConfig, prepareMirror } from './prepare-cargo-sdk.mjs';

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

test('a sanitized Xcode child resolves the unadvertised exact SDK without rewriting its lock', () => {
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
    mkdirSync(join(upstream, 'src'));
    writeFileSync(join(upstream, 'Cargo.toml'), '[package]\nname = "locked-sdk-fixture"\nversion = "0.1.0"\nedition = "2021"\n');
    writeFileSync(join(upstream, 'src/lib.rs'), 'pub fn pinned() {}\n');
    git(['-C', upstream, 'add', '.']);
    git(['-C', upstream, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
      'commit', '--quiet', '-m', 'fixture crate']);
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

    // Model the Xcode child before Tauri read_options(): none of the parent's
    // CARGO_*/GIT_CONFIG_* variables survive. A cold Cargo resolver must obtain
    // the exact commit through project config, not a warmed dependency cache.
    const project = join(directory, 'project with spaces');
    mkdirSync(join(project, '.cargo'), { recursive: true });
    mkdirSync(join(project, 'src'));
    const canonical = pathToFileURL(join(directory, 'unavailable upstream')).href;
    writeFileSync(join(project, 'Cargo.toml'), `[package]
name = "xcode-child-fixture"
version = "0.1.0"
edition = "2021"
[dependencies]
locked-sdk-fixture = { git = "${canonical}", rev = "${pinned}" }
`);
    writeFileSync(join(project, 'src/lib.rs'), 'pub fn child() {}\n');
    const config = join(project, '.cargo/config.toml');
    const original = '# Existing config must survive.\n[build]\njobs = 1\n';
    writeFileSync(config, original);
    persistCargoConfig(config, { url: canonical, revision: pinned }, mirror);
    const persisted = readFileSync(config, 'utf8');
    assert(persisted.startsWith(original));
    assert.throws(() => persistCargoConfig(config, { url: canonical, revision: pinned }, mirror));
    assert.equal(readFileSync(config, 'utf8'), persisted);
    const childEnv = Object.fromEntries(Object.entries(process.env)
      .filter(([key]) => !key.startsWith('CARGO_') && !key.startsWith('GIT_CONFIG_')));
    // The real CI consumes an existing canonical lock; source replacement must
    // never generate or rewrite it to point at the temporary mirror.
    const locked = `version = 4
[[package]]
name = "locked-sdk-fixture"
version = "0.1.0"
source = "git+${canonical}?rev=${pinned}#${pinned}"
[[package]]
name = "xcode-child-fixture"
version = "0.1.0"
dependencies = ["locked-sdk-fixture"]
`;
    writeFileSync(join(project, 'Cargo.lock'), locked);
    const xcodeDirectory = join(project, 'src-tauri/gen/apple');
    mkdirSync(xcodeDirectory, { recursive: true });
    const cargo = () => execFileSync('cargo', ['--config', 'net.retry=0', 'metadata', '--locked', '--format-version', '1'], {
      cwd: xcodeDirectory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...childEnv, CARGO_HOME: join(directory, 'cold-cargo-home') },
    });
    // Negative control: stripped environment without project replacement fails.
    writeFileSync(config, original);
    assert.throws(cargo);
    writeFileSync(config, persisted);
    const metadata = JSON.parse(cargo());
    const dependency = metadata.packages.find((pkg) => pkg.name === 'locked-sdk-fixture');
    assert.equal(dependency.source, `git+${canonical}?rev=${pinned}#${pinned}`);
    assert.equal(readFileSync(join(project, 'Cargo.lock'), 'utf8'), locked);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
