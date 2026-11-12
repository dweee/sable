import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

const RUN_ID_ENV = 'SABLE_E2E_RUN_ID';
const RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function homeserverRunId(): string {
  const runId = process.env[RUN_ID_ENV];
  if (!runId || runId.length !== 36 || !RUN_ID_PATTERN.test(runId)) {
    throw new Error('Missing or invalid SABLE_E2E_RUN_ID; load the Playwright config first');
  }
  return runId;
}

// Only the config entry creates an ID. Workers inherit it, including teardown.
export function initializeHomeserverRunId(): void {
  process.env[RUN_ID_ENV] ??= randomUUID();
  homeserverRunId();
}

export const homeserverStatePath = () => join('tests/e2e/.auth', 'homeserver.json');
