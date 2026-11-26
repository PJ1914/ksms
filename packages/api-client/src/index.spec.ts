import { ApiError, createApiClient } from './index';

describe('api client', () => {
  const original = global.fetch;
  afterEach(() => {
    global.fetch = original;
  });

  it('sends auth, branch and idempotency headers', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ data: 1 }) });
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = createApiClient({
      baseUrl: 'http://x/api/v1',
      getAccessToken: async () => 'tok',
      getBranchId: () => 'b1',
    });
    await client.post('/sales', { a: 1 }, 'key-1');
    const init = fetchMock.mock.calls[0][1];
    expect(init.headers.authorization).toBe('Bearer tok');
    expect(init.headers['x-branch-id']).toBe('b1');
    expect(init.headers['idempotency-key']).toBe('key-1');
  });

  it('reports when a request starts and ends (slow-server notice, FIXES F20)', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({}) }) as unknown as typeof fetch;
    const events: string[] = [];
    const client = createApiClient({
      baseUrl: 'http://x',
      getAccessToken: async () => null,
      onRequest: () => {
        events.push('start');
        return () => events.push('end');
      },
    });
    await client.get('/x');
    expect(events).toEqual(['start', 'end']);
  });

  it('throws ApiError with the server error code', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 409,
      statusText: 'Conflict',
      json: async () => ({ error: { code: 'INSUFFICIENT_STOCK', message: 'No stock' } }),
    }) as unknown as typeof fetch;
    const client = createApiClient({ baseUrl: 'http://x', getAccessToken: async () => null });
    await expect(client.get('/x')).rejects.toMatchObject({
      status: 409,
      code: 'INSUFFICIENT_STOCK',
    });
    await expect(client.get('/x')).rejects.toBeInstanceOf(ApiError);
  });

  it('aborts a stalled request after timeoutMs', async () => {
    global.fetch = jest.fn(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    ) as unknown as typeof fetch;
    const client = createApiClient({
      baseUrl: 'http://x',
      getAccessToken: async () => null,
      timeoutMs: 25,
    });
    await expect(client.get('/slow')).rejects.toThrow('aborted');
  });
});
