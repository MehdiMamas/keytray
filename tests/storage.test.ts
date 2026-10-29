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

import { loadAgentUsed, removeAgentUsed } from '~/lib/storage';

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
