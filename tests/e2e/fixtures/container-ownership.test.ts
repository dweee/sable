import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  HOMESERVER_RUN_LABEL,
  removeOwnedHomeserver,
  removeStaleHomeservers,
} from './container-ownership';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const FOREIGN_RUN_ID = '22222222-2222-4222-8222-222222222222';
const ID = 'a'.repeat(64);
const inspection = (labels: Record<string, string> | null = { [HOMESERVER_RUN_LABEL]: RUN_ID }) =>
  JSON.stringify([{ Id: ID, Config: { Labels: labels } }]);

beforeEach(() => vi.stubEnv('SABLE_E2E_RUN_ID', RUN_ID));
afterEach(() => vi.unstubAllEnvs());

test('removes its own exact ID only after checking its run label', async () => {
  const docker = vi.fn().mockResolvedValue({ stdout: inspection() });
  await removeOwnedHomeserver(ID, docker);
  expect(docker.mock.calls).toEqual([[['inspect', '--type', 'container', ID]], [['rm', '-f', ID]]]);
});

test('stale selection intersects the exact run label and port, then inspects again', async () => {
  const docker = vi.fn((args: string[]) =>
    Promise.resolve({ stdout: args[0] === 'ps' ? `${ID}\n` : inspection() })
  );
  await removeStaleHomeservers(18008, docker);
  expect(docker.mock.calls).toEqual([
    [
      [
        'ps',
        '-aq',
        '--no-trunc',
        '--filter',
        `label=${HOMESERVER_RUN_LABEL}=${RUN_ID}`,
        '--filter',
        'publish=18008',
      ],
    ],
    [['inspect', '--type', 'container', ID]],
    [['rm', '-f', ID]],
  ]);
});

test.each([
  ['foreign run', { [HOMESERVER_RUN_LABEL]: FOREIGN_RUN_ID }],
  ['unknown label', { unrelated: RUN_ID }],
  ['missing run label', {}],
  ['missing labels', null],
])('never removes a %s container even if the port query returns it', async (_name, labels) => {
  const docker = vi.fn((args: string[]) =>
    Promise.resolve({ stdout: args[0] === 'ps' ? `${ID}\n` : inspection(labels) })
  );
  await expect(removeStaleHomeservers(18008, docker)).rejects.toThrow('Refusing');
  expect(docker.mock.calls.map(([args]) => args[0])).toEqual(['ps', 'inspect']);
  docker.mockClear();
  await expect(removeOwnedHomeserver(ID, docker)).rejects.toThrow('Refusing');
  expect(docker.mock.calls.map(([args]) => args[0])).toEqual(['inspect']);
});

test.each([
  undefined,
  '',
  'not-a-uuid',
  RUN_ID + '\n',
  ` ${RUN_ID}`,
  RUN_ID.toUpperCase().replace('11111111', 'FFFFFFFF'),
])('fails closed before any Docker call for invalid run ID %s', async (runId) => {
  vi.stubEnv('SABLE_E2E_RUN_ID', runId);
  const docker = vi.fn();
  await expect(removeStaleHomeservers(18008, docker)).rejects.toThrow('SABLE_E2E_RUN_ID');
  await expect(removeOwnedHomeserver(ID, docker)).rejects.toThrow('SABLE_E2E_RUN_ID');
  expect(docker).not.toHaveBeenCalled();
});

test.each(['name', 'a'.repeat(12), '--all', ID + '\n', '', undefined, null])(
  'rejects non-exact container reference %s before Docker',
  async (id) => {
    const docker = vi.fn();
    await expect(removeOwnedHomeserver(id as string, docker)).rejects.toThrow('full container ID');
    expect(docker).not.toHaveBeenCalled();
  }
);

test.each([
  'not json',
  'null',
  '{}',
  '[]',
  '[null]',
  JSON.stringify([{ Id: 'b'.repeat(64), Config: { Labels: { [HOMESERVER_RUN_LABEL]: RUN_ID } } }]),
  JSON.stringify([{ Id: ID }]),
  JSON.stringify([{ Id: ID }, { Id: ID }]),
])('never removes on incomplete, malformed or mismatched inspection %s', async (stdout) => {
  const docker = vi.fn().mockResolvedValue({ stdout });
  await expect(removeOwnedHomeserver(ID, docker)).rejects.toThrow();
  expect(docker).toHaveBeenCalledTimes(1);
});

test('inspection failure never falls through to removal', async () => {
  const docker = vi.fn().mockRejectedValue(new Error('daemon unavailable'));
  await expect(removeOwnedHomeserver(ID, docker)).rejects.toThrow('daemon unavailable');
  expect(docker).toHaveBeenCalledTimes(1);
});

test('an empty scoped query removes nothing', async () => {
  const docker = vi.fn().mockResolvedValue({ stdout: '' });
  await removeStaleHomeservers(18008, docker);
  expect(docker).toHaveBeenCalledTimes(1);
});
