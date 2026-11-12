import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { HOMESERVER_RUN_LABEL, removeOwnedHomeserver } from './container-ownership';
import { homeserverRunId } from './runtime';

const execFileAsync = promisify(execFile);

const HOMESERVER_IMAGE = 'ghcr.io/continuwuity/continuwuity:latest';
const LIVEKIT_IMAGE = 'livekit/livekit-server:v1.13.11';
const JWT_IMAGE = 'ghcr.io/element-hq/lk-jwt-service:latest';
const PROXY_IMAGE = 'caddy:2';

const NETWORK = 'host';
const ownedContainers: string[] = [];
const SERVER_NAME = 'hs.test';
const HOMESERVER_PORT = 18108;
const JWT_PORT = 18080;
const LIVEKIT_PORT = 7880;
const LIVEKIT_TCP_PORT = 7881;
const LIVEKIT_UDP_PORT = 7882;
const REGISTRATION_TOKEN = 'sable-e2e';
const LIVEKIT_KEY = 'devkey';
const LIVEKIT_SECRET = 'secretsecretsecretsecretsecretsecret';
const CONTAINERS = [
  `sable-e2e-call-${homeserverRunId()}-hs`,
  `sable-e2e-call-${homeserverRunId()}-proxy`,
  `sable-e2e-call-${homeserverRunId()}-lk`,
  `sable-e2e-call-${homeserverRunId()}-jwt`,
];

export const CALL_HOMESERVER_URL = `http://127.0.0.1:${String(HOMESERVER_PORT)}`;
export const CALL_PASSWORD = 'test-passw0rd';

async function docker(...args: string[]): Promise<string> {
  const run = args[0] === 'run';
  if (run) args.splice(1, 0, '--label', `${HOMESERVER_RUN_LABEL}=${homeserverRunId()}`);
  const { stdout } = await execFileAsync('docker', args);
  const result = stdout.trim();
  if (run) {
    if (!/^[0-9a-f]{64}$/.test(result))
      throw new Error('Docker did not return a full container ID');
    ownedContainers.push(result);
    console.log(`Owned call container ${result}`);
  }
  return result;
}

export async function stopCallStack(): Promise<void> {
  const results = await Promise.allSettled(ownedContainers.map((id) => removeOwnedHomeserver(id)));
  if (results.some((result) => result.status === 'rejected')) {
    throw new AggregateError(
      results
        .filter((result) => result.status === 'rejected')
        .map((result): unknown => result.reason),
      'Call container cleanup failed'
    );
  }
  ownedContainers.length = 0;
}

// The JWT service validates each OpenID token against the federation API of the server named in
// it, over HTTPS on 8448, so the homeserver is also reachable under its server name through a
// TLS-terminating proxy on loopback. Host networking avoids bridge changes that
// invalidate Chromium requests; every listener is bound to loopback.
export async function startCallStack(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'sable-call-stack-'));
  const caddyfile = join(dir, 'Caddyfile');
  const livekitConfig = join(dir, 'livekit.yaml');
  await writeFile(
    caddyfile,
    `{\n  skip_install_trust\n  auto_https disable_redirects\n}\n${SERVER_NAME}:8448 {\n  tls internal\n  bind 127.0.0.1\n  reverse_proxy 127.0.0.1:${String(HOMESERVER_PORT)}\n}\n`
  );
  await writeFile(
    livekitConfig,
    [
      `port: ${String(LIVEKIT_PORT)}`,
      'bind_addresses: [127.0.0.1]',
      'rtc:',
      `  tcp_port: ${String(LIVEKIT_TCP_PORT)}`,
      `  udp_port: ${String(LIVEKIT_UDP_PORT)}`,
      '  use_external_ip: false',
      '  node_ip: 127.0.0.1',
      'keys:',
      `  ${LIVEKIT_KEY}: ${LIVEKIT_SECRET}`,
      '',
    ].join('\n')
  );

  await docker(
    'run',
    '-d',
    '--name',
    CONTAINERS[0],
    '--network',
    NETWORK,
    '--tmpfs',
    '/database',
    '-e',
    `CONTINUWUITY_SERVER_NAME=${SERVER_NAME}`,
    '-e',
    `CONTINUWUITY_WELL_KNOWN__CLIENT=${CALL_HOMESERVER_URL}`,
    '-e',
    'CONTINUWUITY_ADDRESS=127.0.0.1',
    '-e',
    `CONTINUWUITY_PORT=${String(HOMESERVER_PORT)}`,
    '-e',
    'CONTINUWUITY_DATABASE_PATH=/database',
    '-e',
    'CONTINUWUITY_ALLOW_REGISTRATION=true',
    '-e',
    `CONTINUWUITY_REGISTRATION_TOKEN=${REGISTRATION_TOKEN}`,
    '-e',
    'CONTINUWUITY_YES_I_AM_VERY_VERY_SURE_I_WANT_AN_OPEN_REGISTRATION_SERVER_PRONE_TO_ABUSE=true',
    '-e',
    'CONTINUWUITY_FORCE_DISABLE_FIRST_RUN_MODE=true',
    '-e',
    'CONTINUWUITY_ALLOW_FEDERATION=true',
    '-e',
    'CONTINUWUITY_ALLOW_CHECK_FOR_UPDATES=false',
    '-e',
    `CONTINUWUITY_MATRIX_RTC__FOCI=[{type="livekit",livekit_service_url="http://127.0.0.1:${String(JWT_PORT)}"}]`,
    HOMESERVER_IMAGE
  );
  await docker(
    'run',
    '-d',
    '--name',
    CONTAINERS[1],
    '--network',
    NETWORK,
    '-v',
    `${caddyfile}:/etc/caddy/Caddyfile:ro`,
    PROXY_IMAGE
  );
  await docker(
    'run',
    '-d',
    '--name',
    CONTAINERS[2],
    '--network',
    NETWORK,
    '-v',
    `${livekitConfig}:/etc/livekit.yaml:ro`,
    LIVEKIT_IMAGE,
    '--config',
    '/etc/livekit.yaml'
  );
  await docker(
    'run',
    '-d',
    '--name',
    CONTAINERS[3],
    '--network',
    NETWORK,
    '--add-host',
    `${SERVER_NAME}:127.0.0.1`,
    '-e',
    `LIVEKIT_URL=ws://127.0.0.1:${String(LIVEKIT_PORT)}`,
    '-e',
    `LIVEKIT_KEY=${LIVEKIT_KEY}`,
    '-e',
    `LIVEKIT_SECRET=${LIVEKIT_SECRET}`,
    '-e',
    `LIVEKIT_FULL_ACCESS_HOMESERVERS=${SERVER_NAME}`,
    '-e',
    `LIVEKIT_JWT_BIND=127.0.0.1:${String(JWT_PORT)}`,
    '-e',
    'LIVEKIT_INSECURE_SKIP_VERIFY_TLS=YES_I_KNOW_WHAT_I_AM_DOING',
    JWT_IMAGE
  );

  await waitFor(`${CALL_HOMESERVER_URL}/_matrix/client/versions`);
  await waitFor(`http://127.0.0.1:${String(JWT_PORT)}/healthz`);
  await waitFor(`http://127.0.0.1:${String(LIVEKIT_PORT)}/`);
}

export async function callStackLogs(): Promise<string> {
  const parts = await Promise.all(
    CONTAINERS.map(async (name) => {
      const { stdout, stderr } = await execFileAsync('docker', [
        'logs',
        '--tail',
        '200',
        name,
      ]).catch((error: unknown) => ({ stdout: '', stderr: String(error) }));
      return `=== ${name} ===\n${stdout}${stderr}`;
    })
  );
  return parts.join('\n');
}

async function waitFor(url: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  let failure = 'no attempt made';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
      if (response.status < 500) return;
      failure = `HTTP ${String(response.status)}`;
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${url} did not come up: ${failure}\n${await callStackLogs()}`);
}

export async function registerCallUser(
  username: string
): Promise<{ accessToken: string; userId: string }> {
  const url = `${CALL_HOMESERVER_URL}/_matrix/client/v3/register?kind=user`;
  const probe = await fetch(url, { method: 'POST', body: JSON.stringify({ username }) });
  const { session } = (await probe.json()) as { session: string };
  const response = await fetch(url, {
    method: 'POST',
    body: JSON.stringify({
      username,
      password: CALL_PASSWORD,
      auth: { type: 'm.login.registration_token', token: REGISTRATION_TOKEN, session },
    }),
  });
  if (!response.ok) {
    throw new Error(`register failed: ${String(response.status)} ${await response.text()}`);
  }
  const body = (await response.json()) as { access_token: string; user_id: string };
  return { accessToken: body.access_token, userId: body.user_id };
}

export async function createCallRoom(
  accessToken: string,
  name: string,
  invite: string[],
  encrypted: boolean
): Promise<string> {
  const headers = { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' };
  const create = await fetch(`${CALL_HOMESERVER_URL}/_matrix/client/v3/createRoom`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name,
      preset: 'private_chat',
      visibility: 'private',
      initial_state: encrypted
        ? [
            {
              type: 'm.room.encryption',
              state_key: '',
              content: { algorithm: 'm.megolm.v1.aes-sha2' },
            },
          ]
        : [],
      invite,
      power_level_content_override: {
        events: { 'org.matrix.msc3401.call.member': 0, 'org.matrix.msc4143.rtc.member': 0 },
      },
    }),
  });
  if (!create.ok) {
    throw new Error(`create room failed: ${String(create.status)} ${await create.text()}`);
  }
  return ((await create.json()) as { room_id: string }).room_id;
}

export async function joinCallRoom(accessToken: string, roomId: string): Promise<void> {
  const response = await fetch(
    `${CALL_HOMESERVER_URL}/_matrix/client/v3/join/${encodeURIComponent(roomId)}`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: '{}',
    }
  );
  if (!response.ok) {
    throw new Error(`join failed: ${String(response.status)} ${await response.text()}`);
  }
}
