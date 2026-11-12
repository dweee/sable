import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const sdk = 'https://git.sable.moe/SableClient/matrix-rust-sdk';

export function lockedSdk(lockfile) {
  const sources = [...lockfile.matchAll(/^source = "git\+([^"\n]+)"$/gm)]
    .map((match) => match[1])
    .filter((source) => source.startsWith(`${sdk}?`));
  assert(sources.length > 0, 'Cargo.lock must pin the Matrix SDK');
  const revisions = new Set();
  for (const source of sources) {
    const match = source.slice(sdk.length).match(/^\?rev=([0-9a-f]{40})#([0-9a-f]{40})$/);
    assert(match && match[1] === match[2], 'SDK revision and locked commit must agree');
    revisions.add(match[1]);
  }
  assert.equal(revisions.size, 1, 'Cargo.lock must select one Matrix SDK commit');
  return { url: sdk, revision: [...revisions][0] };
}

export function prepareMirror(source, parent) {
  assert.match(source.revision, /^[0-9a-f]{40}$/);
  const mirror = mkdtempSync(join(parent, 'sable-cargo-sdk-'));
  const git = (...args) =>
    execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '--bare', '--quiet', mirror);
  // Cargo fetches advertised heads, which can omit an otherwise fetchable pinned commit.
  // Advertise that exact object locally without changing Cargo's canonical URL or lock.
  git('-C', mirror, 'fetch', '--no-tags', '--quiet', source.url, source.revision);
  const actual = git('-C', mirror, 'rev-parse', 'FETCH_HEAD^{commit}').trim();
  assert.equal(actual, source.revision, 'Fetched SDK commit must match Cargo.lock');
  git('-C', mirror, 'update-ref', 'refs/heads/sable-locked-sdk', actual);
  git('-C', mirror, 'symbolic-ref', 'HEAD', 'refs/heads/sable-locked-sdk');
  return mirror;
}

export function gitEnvironment(source, mirror, inheritedCount = '0') {
  assert.match(inheritedCount, /^(0|[1-9][0-9]*)$/);
  const index = Number(inheritedCount);
  assert(Number.isSafeInteger(index) && index < 100, 'Invalid inherited Git config count');
  return {
    GIT_CONFIG_COUNT: String(index + 1),
    [`GIT_CONFIG_KEY_${index}`]: `url.${pathToFileURL(resolve(mirror)).href}.insteadOf`,
    [`GIT_CONFIG_VALUE_${index}`]: source.url,
  };
}

// Xcode drops Git config variables, and Tauri constructs metadata before
// restoring CARGO_* options. Project source replacement survives both boundaries
// and keeps Cargo.lock's canonical source identity and exact revision intact.
export function persistCargoConfig(configPath, source, mirror) {
  const existing = readFileSync(configPath, 'utf8');
  assert(
    !/^\s*\[source(?:\.|\])/m.test(existing),
    'Refusing to replace existing Cargo source configuration',
  );
  assert.match(source.revision, /^[0-9a-f]{40}$/);
  appendFileSync(configPath, `
# Job-local exact SDK mirror for Xcode child processes.
[source.sable-locked-sdk]
git = ${JSON.stringify(source.url)}
rev = "${source.revision}"
replace-with = "sable-job-sdk"

[source.sable-job-sdk]
git = ${JSON.stringify(pathToFileURL(resolve(mirror)).href)}
rev = "${source.revision}"
`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert(process.env.GITHUB_ENV, 'This setup helper requires a job-local GITHUB_ENV');
  const source = lockedSdk(readFileSync('Cargo.lock', 'utf8'));
  const mirror = prepareMirror(source, process.env.RUNNER_TEMP ?? tmpdir());
  const environment = gitEnvironment(source, mirror, process.env.GIT_CONFIG_COUNT ?? '0');
  if (process.argv.includes('--persist-cargo-config')) {
    persistCargoConfig('.cargo/config.toml', source, mirror);
  }
  for (const [key, value] of Object.entries(environment)) {
    assert(!/[\r\n]/.test(value), 'Git environment values must be single-line');
    appendFileSync(process.env.GITHUB_ENV, `${key}=${value}\n`);
  }
  console.log(`Prepared exact Matrix SDK ${source.revision} for Cargo Git fetching`);
}
