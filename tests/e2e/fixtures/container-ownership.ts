import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homeserverRunId } from './runtime';

export const HOMESERVER_RUN_LABEL = 'moe.sable.e2e.run-id';
const execFileAsync = promisify(execFile);
type Docker = (args: string[]) => Promise<{ stdout: string }>;
const docker: Docker = (args) => execFileAsync('docker', args);

// Require a full immutable ID: never allow a name, option or abbreviated ID.
export async function removeOwnedHomeserver(
  containerId: string,
  runDocker: Docker = docker
): Promise<void> {
  const runId = homeserverRunId();
  if (
    typeof containerId !== 'string' ||
    containerId.length !== 64 ||
    !/^[0-9a-f]{64}$/.test(containerId)
  ) {
    throw new Error('Refusing to remove homeserver without a full container ID');
  }
  const { stdout } = await runDocker(['inspect', '--type', 'container', containerId]);
  const inspected = JSON.parse(stdout) as {
    Id?: string;
    Config?: { Labels?: Record<string, string> | null };
  }[];
  if (
    !Array.isArray(inspected) ||
    inspected.length !== 1 ||
    inspected[0]?.Id !== containerId ||
    inspected[0]?.Config?.Labels?.[HOMESERVER_RUN_LABEL] !== runId
  ) {
    throw new Error(`Refusing to remove foreign or unlabelled homeserver ${containerId}`);
  }
  await runDocker(['rm', '-f', containerId]);
}

export async function removeStaleHomeservers(
  hostPort: number,
  runDocker: Docker = docker
): Promise<void> {
  const runId = homeserverRunId();
  const { stdout } = await runDocker([
    'ps',
    '-aq',
    '--no-trunc',
    '--filter',
    `label=${HOMESERVER_RUN_LABEL}=${runId}`,
    '--filter',
    `publish=${String(hostPort)}`,
  ]);
  for (const containerId of stdout.split('\n').filter(Boolean)) {
    await removeOwnedHomeserver(containerId, runDocker);
  }
}
