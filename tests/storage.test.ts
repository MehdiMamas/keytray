import { beforeEach, describe, expect, it, vi } from 'vitest';

const store: Record<string, unknown> = {};
vi.mock('wxt/browser', () => ({
  browser: {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: store[key] }),
        set: async (values: Record<string, unknown>) => {
          Object.assign(store, values);
        },
      },
    },
  },
}));

import { loadAgentUsed, removeAgentUsed, validateCustomOAuth } from '~/lib/storage';

describe('removeAgentUsed', () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
  });

  it('drops only the given ids', async () => {
    store.agentUsed = ['a:1', 'a:2', 'b:1'];
    await removeAgentUsed(['a:1', 'a:2']);
    expect([...(await loadAgentUsed())]).toEqual(['b:1']);
  });
});

describe('validateCustomOAuth', () => {
  const id = 'abc.apps.googleusercontent.com';

  it('trims both fields', () => {
    expect(validateCustomOAuth({ clientId: `  ${id} `, clientSecret: ' s ' })).toEqual({
      ok: true,
      value: { clientId: id, clientSecret: 's' },
    });
  });

  it('asks for both when the secret is empty', () => {
    expect(validateCustomOAuth({ clientId: id, clientSecret: '  ' }).ok).toBe(false);
  });

  it('rejects a Client ID that does not end in .apps.googleusercontent.com', () => {
    const result = validateCustomOAuth({ clientId: 'abc', clientSecret: 's' });
    expect(result.ok).toBe(false);
  });
});
