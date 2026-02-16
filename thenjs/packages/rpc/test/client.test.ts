import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RPCError, createRPCClient, generateClientCode } from '../src/client.js';

describe('RPCError', () => {
  it('constructor sets message, code, and name', () => {
    const error = new RPCError({
      message: 'Something went wrong',
      code: 'INTERNAL_ERROR',
    });

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(RPCError);
    expect(error.message).toBe('Something went wrong');
    expect(error.code).toBe('INTERNAL_ERROR');
    expect(error.name).toBe('RPCError');
  });

  it('constructor sets issues when provided', () => {
    const issues = [
      { message: 'Field required', path: ['name'] as (string | number)[] },
      { message: 'Must be positive', path: ['age'] as (string | number)[] },
    ];

    const error = new RPCError({
      message: 'Validation failed',
      code: 'VALIDATION_ERROR',
      issues,
    });

    expect(error.issues).toEqual(issues);
    expect(error.issues).toHaveLength(2);
  });

  it('issues is undefined when not provided', () => {
    const error = new RPCError({
      message: 'Not found',
      code: 'NOT_FOUND',
    });

    expect(error.issues).toBeUndefined();
  });
});

describe('generateClientCode', () => {
  it('returns a string with import statement and client creation', () => {
    const manifest = {
      procedures: {
        'user.getById': { type: 'query', path: 'user.getById' },
        'user.create': { type: 'mutation', path: 'user.create' },
      },
    };

    const code = generateClientCode(manifest);

    expect(code).toContain("import { createRPCClient } from '@thenjs/rpc/client'");
    expect(code).toContain('createRPCClient(');
    expect(code).toContain("baseUrl: '/_rpc'");
    expect(code).toContain('export const rpc');
  });

  it('uses custom baseUrl when provided', () => {
    const manifest = {
      procedures: {},
    };

    const code = generateClientCode(manifest, '/api/rpc');

    expect(code).toContain("baseUrl: '/api/rpc'");
  });
});

describe('createRPCClient', () => {
  let originalFetch: typeof globalThis.fetch;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // Helper to create a mock fetch response
  function mockFetchResponse(data: unknown, status = 200) {
    return Promise.resolve({
      status,
      json: () => Promise.resolve(data),
      ok: status >= 200 && status < 300,
    } as Response);
  }

  describe('proxy creates nested paths', () => {
    it('accessing nested properties builds up the path', () => {
      const client = createRPCClient<any>({
        baseUrl: '/_rpc',
        fetch: mockFetch,
      });

      // Accessing nested properties should not throw
      const nested = client.user.profile.settings;
      expect(nested).toBeDefined();
    });

    it('returns undefined for .then to prevent accidental awaiting', () => {
      const client = createRPCClient<any>({ fetch: mockFetch });
      expect((client as any).then).toBeUndefined();
      expect((client as any).user.then).toBeUndefined();
    });
  });

  describe('.query() makes GET request', () => {
    it('calls fetch with GET and correct URL', async () => {
      mockFetch.mockReturnValue(
        mockFetchResponse({ result: { id: '1', name: 'Alice' } }),
      );

      const client = createRPCClient<any>({
        baseUrl: '/_rpc',
        fetch: mockFetch,
      });

      const result = await client.user.getById.query({ id: '1' });

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url] = mockFetch.mock.calls[0];
      // The URL should contain the procedure path
      expect(url).toContain('/_rpc/user.getById');
      // The URL should contain the input as a search param
      expect(url).toContain('input=');

      expect(result).toEqual({ id: '1', name: 'Alice' });
    });

    it('calls fetch without input param when no input is given', async () => {
      mockFetch.mockReturnValue(
        mockFetchResponse({ result: ['item1', 'item2'] }),
      );

      const client = createRPCClient<any>({
        baseUrl: '/_rpc',
        fetch: mockFetch,
      });

      const result = await client.posts.list.query();

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('/_rpc/posts.list');
      // Should not have input param
      expect(url).not.toContain('input=');

      expect(result).toEqual(['item1', 'item2']);
    });

    it('includes default headers in the request', async () => {
      mockFetch.mockReturnValue(
        mockFetchResponse({ result: 'ok' }),
      );

      const client = createRPCClient<any>({
        baseUrl: '/_rpc',
        fetch: mockFetch,
        headers: { Authorization: 'Bearer token123' },
      });

      await client.health.query();

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers).toEqual(
        expect.objectContaining({ Authorization: 'Bearer token123' }),
      );
    });

    it('throws RPCError when response contains error', async () => {
      mockFetch.mockReturnValue(
        mockFetchResponse({
          error: { message: 'Not found', code: 'NOT_FOUND' },
        }),
      );

      const client = createRPCClient<any>({
        baseUrl: '/_rpc',
        fetch: mockFetch,
      });

      await expect(client.user.getById.query({ id: '999' })).rejects.toThrow(RPCError);
      await expect(client.user.getById.query({ id: '999' })).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: 'Not found',
      });
    });
  });

  describe('.mutate() makes POST request', () => {
    it('calls fetch with POST method and JSON body', async () => {
      mockFetch.mockReturnValue(
        mockFetchResponse({ result: { id: 'new-1', name: 'Bob' } }),
      );

      const client = createRPCClient<any>({
        baseUrl: '/_rpc',
        fetch: mockFetch,
      });

      const result = await client.user.create.mutate({ name: 'Bob' });

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('/_rpc/user.create');
      expect(options.method).toBe('POST');
      expect(options.headers['content-type']).toBe('application/json');
      expect(options.body).toBeDefined();

      // Body should be JSON-encoded
      const parsedBody = JSON.parse(options.body);
      expect(parsedBody).toEqual({ name: 'Bob' });

      expect(result).toEqual({ id: 'new-1', name: 'Bob' });
    });

    it('includes default headers in POST requests', async () => {
      mockFetch.mockReturnValue(
        mockFetchResponse({ result: 'created' }),
      );

      const client = createRPCClient<any>({
        baseUrl: '/_rpc',
        fetch: mockFetch,
        headers: { 'X-Custom': 'value' },
      });

      await client.item.create.mutate({ title: 'Test' });

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers).toEqual(
        expect.objectContaining({
          'content-type': 'application/json',
          'X-Custom': 'value',
        }),
      );
    });

    it('throws RPCError when mutation response contains error', async () => {
      mockFetch.mockReturnValue(
        mockFetchResponse({
          error: {
            message: 'Validation failed',
            code: 'VALIDATION_ERROR',
            issues: [{ message: 'name is required', path: ['name'] }],
          },
        }),
      );

      const client = createRPCClient<any>({
        baseUrl: '/_rpc',
        fetch: mockFetch,
      });

      try {
        await client.user.create.mutate({});
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RPCError);
        const rpcErr = err as RPCError;
        expect(rpcErr.code).toBe('VALIDATION_ERROR');
        expect(rpcErr.issues).toHaveLength(1);
        expect(rpcErr.issues![0].message).toBe('name is required');
      }
    });
  });

  describe('useSWR integration', () => {
    it('returns key and fetcher for SWR usage', () => {
      const client = createRPCClient<any>({
        baseUrl: '/_rpc',
        fetch: mockFetch,
      });

      const swrConfig = client.user.getById.useSWR({ id: '1' });

      expect(swrConfig).toBeDefined();
      expect(swrConfig.key).toBe('rpc:user.getById:{"id":"1"}');
      expect(typeof swrConfig.fetcher).toBe('function');
    });

    it('useSWR fetcher calls fetch with GET', async () => {
      mockFetch.mockReturnValue(
        mockFetchResponse({ result: { id: '1', name: 'Alice' } }),
      );

      const client = createRPCClient<any>({
        baseUrl: '/_rpc',
        fetch: mockFetch,
      });

      const swrConfig = client.user.getById.useSWR({ id: '1' });
      const result = await swrConfig.fetcher();

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('/_rpc/user.getById');
      expect(result).toEqual({ id: '1', name: 'Alice' });
    });
  });

  describe('direct call (apply trap)', () => {
    it('direct function call uses POST', async () => {
      mockFetch.mockReturnValue(
        mockFetchResponse({ result: { done: true } }),
      );

      const client = createRPCClient<any>({
        baseUrl: '/_rpc',
        fetch: mockFetch,
      });

      // Direct call syntax: client.user.action(input)
      const result = await (client.user.action as any)({ data: 'test' });

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('/_rpc/user.action');
      expect(options.method).toBe('POST');

      expect(result).toEqual({ done: true });
    });
  });

  describe('defaults', () => {
    it('uses /_rpc as default baseUrl', async () => {
      mockFetch.mockReturnValue(
        mockFetchResponse({ result: 'ok' }),
      );

      const client = createRPCClient<any>({ fetch: mockFetch });
      await client.health.query();

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('/_rpc/health');
    });
  });
});
