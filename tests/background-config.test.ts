import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store: Record<string, unknown> = {};
type Port = {
  onMessage: { fn?: (m: unknown) => void; addListener: (f: (m: unknown) => void) => void };
  onDisconnect: { fn?: () => void; addListener: (f: () => void) => void };
  postMessage: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
};
const ports: Port[] = [];
const runAgentCommand = vi.fn(async () => ({ ok: true }));

vi.stubGlobal('defineBackground', (main: () => void) => main);
vi.mock('extpay', () => ({
  default: () => ({ startBackground: () => {}, onPaid: { addListener: () => {} } }),
}));
vi.mock('~/lib/agent', async (orig) => ({ ...(await orig<typeof import('~/lib/agent')>()), runAgentCommand }));
vi.mock('wxt/browser', () => {
  const event = { addListener: () => {} };
  return {
    browser: {
      alarms: { get: async () => ({ periodInMinutes: 1 }), create: async () => {}, onAlarm: event },
      runtime: {
        onInstalled: event,
        onMessage: event,
        connectNative: () => {
          const port: Port = {
            onMessage: { addListener: (f) => (port.onMessage.fn = f) },
            onDisconnect: { addListener: (f) => (port.onDisconnect.fn = f) },
            postMessage: vi.fn(),
            disconnect: vi.fn(),
          };
          ports.push(port);
          return port;
        },
        id: 'ext',
        getURL: (path: string) => `chrome-extension://ext${path}`,
      },
      notifications: { onClicked: event },
      storage: {
        onChanged: event,
        local: {
          get: async (key: string) => ({ [key]: store[key] }),
          set: async (values: Record<string, unknown>) => {
            Object.assign(store, values);
          },
          remove: async (key: string) => {
            delete store[key];
          },
        },
      },
    },
  };
});

const background = (await import('~/entrypoints/background')).default as unknown as () => void;
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
const settings = () => (store.otpState as { settings: Record<string, unknown> }).settings;

describe('agent config file', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    ports.length = 0;
    runAgentCommand.mockClear();
    for (const key of Object.keys(store)) delete store[key];
  });
  afterEach(() => vi.useRealTimers());

  it('probes once at start, applies a config reply and keeps the port', async () => {
    background();
    await flush();
    expect(ports).toHaveLength(1);
    expect(ports[0].postMessage).toHaveBeenCalledWith({ kind: 'getConfig' });
    ports[0].onMessage.fn!({ kind: 'config', config: { agentSignIn: true, allowAll: true } });
    await flush();
    expect(settings().agentEnabled).toBe(true);
    expect(settings().agentConfigFromFile).toBe(true);
    expect(settings().agentAllowlist).toContain('*');
    expect(runAgentCommand).not.toHaveBeenCalled();
    expect(ports[0].disconnect).not.toHaveBeenCalled();
  });

  it('drops the probe port when the file does not enable it', async () => {
    background();
    await flush();
    ports[0].onMessage.fn!({ kind: 'config', config: null });
    await flush();
    expect(ports[0].disconnect).toHaveBeenCalled();
    expect(runAgentCommand).not.toHaveBeenCalled();
  });

  it('does not reconnect when the probe port disconnects', async () => {
    background();
    await flush();
    ports[0].onDisconnect.fn!();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(ports).toHaveLength(1);
  });

  it('does not probe when the user switched the agent off', async () => {
    store.otpState = { settings: { agentOffByUser: true } };
    background();
    await flush();
    expect(ports).toHaveLength(0);
  });
});
