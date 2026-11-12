import { afterEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  docker: vi.fn<(file: string, args: string[]) => string>(),
  labels: vi.fn<(labels: Record<string, string>) => void>(),
  start: vi.fn<() => Promise<{ getId: () => string }>>(),
}));
vi.mock('node:child_process', () => ({
  execFile: Object.assign(vi.fn(), {
    [Symbol.for('nodejs.util.promisify.custom')]: (file: string, args: string[]) =>
      Promise.resolve({
        stdout: mocks.docker(file, args),
        stderr: '',
      }),
  }),
}));
vi.mock('testcontainers', () => ({
  GenericContainer: class {
    withLabels(labels: Record<string, string>) {
      mocks.labels(labels);
      return this;
    }
    withExposedPorts() {
      return this;
    }
    withEnvironment() {
      return this;
    }
    withTmpFs() {
      return this;
    }
    withWaitStrategy() {
      return this;
    }
    withStartupTimeout() {
      return this;
    }
    withAutoCleanup() {
      return this;
    }
    start() {
      return mocks.start();
    }
  },
  Wait: { forLogMessage: vi.fn() },
}));
vi.mock('@playwright/test', () => ({
  defineConfig: (config: unknown) => config,
  devices: {},
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.resetModules();
});

test('config creates an ID inherited across setup and teardown module loads', async () => {
  vi.stubEnv('SABLE_E2E_RUN_ID', undefined);
  const id = 'a'.repeat(64);
  mocks.docker.mockImplementation((file: string, args: string[]) => {
    expect(file).toBe('docker');
    if (args[0] === 'inspect') {
      return JSON.stringify([{ Id: id, Config: { Labels: mocks.labels.mock.calls[0][0] } }]);
    }
    return '';
  });
  mocks.start.mockResolvedValue({ getId: () => id });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

  await import('../../../playwright.config');
  const { homeserverRunId } = await import('./runtime');
  const runId = homeserverRunId();
  expect(runId).toMatch(/^[0-9a-f-]{36}$/);
  const { startContinuwuity } = await import('./continuwuity');
  const homeserver = await startContinuwuity();
  expect(mocks.labels).toHaveBeenCalledExactlyOnceWith({ 'moe.sable.e2e.run-id': runId });
  expect(mocks.docker.mock.calls[0][1]).toContain(`label=moe.sable.e2e.run-id=${runId}`);

  // Playwright reloads config/modules in workers, inheriting the parent's env.
  vi.resetModules();
  await import('../../../playwright.config');
  expect(process.env.SABLE_E2E_RUN_ID).toBe(runId);
  const { removeContinuwuity } = await import('./continuwuity');
  await removeContinuwuity(homeserver.containerId);
  expect(mocks.docker.mock.calls.slice(-2)).toEqual([
    ['docker', ['inspect', '--type', 'container', id]],
    ['docker', ['rm', '-f', id]],
  ]);

  vi.stubEnv('SABLE_E2E_RUN_ID', undefined);
  vi.resetModules();
  await import('../../../playwright.config');
  expect(process.env.SABLE_E2E_RUN_ID).not.toBe(runId);
});

test.each([undefined, '', 'invalid'])(
  'fixture startup fails closed without a valid inherited ID %s',
  async (runId) => {
    vi.stubEnv('SABLE_E2E_RUN_ID', runId);
    const { startContinuwuity } = await import('./continuwuity');
    await expect(startContinuwuity()).rejects.toThrow('SABLE_E2E_RUN_ID');
    expect(mocks.docker).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  }
);

test('config refuses an existing malformed ID instead of replacing it', async () => {
  vi.stubEnv('SABLE_E2E_RUN_ID', 'invalid');
  await expect(import('../../../playwright.config')).rejects.toThrow('SABLE_E2E_RUN_ID');
  expect(process.env.SABLE_E2E_RUN_ID).toBe('invalid');
});
