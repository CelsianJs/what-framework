import { describe, it, expect } from 'vitest';
import { thenVitePlugin } from '../src/vite-plugin.js';

describe('thenVitePlugin', () => {
  it('returns Plugin array with at least one plugin', () => {
    const plugins = thenVitePlugin();
    expect(Array.isArray(plugins)).toBe(true);
    expect(plugins.length).toBeGreaterThanOrEqual(1);
  });

  it('returns plugin named "thenjs"', () => {
    const plugins = thenVitePlugin();
    const names = plugins.map((p) => p.name);
    expect(names).toContain('thenjs');
  });

  it('plugin has required Vite hooks: configResolved, configureServer, resolveId, load', () => {
    const plugins = thenVitePlugin();
    const plugin = plugins.find((p) => p.name === 'thenjs')!;
    expect(plugin).toBeDefined();
    expect(plugin).toHaveProperty('configResolved');
    expect(plugin).toHaveProperty('configureServer');
    expect(plugin).toHaveProperty('resolveId');
    expect(plugin).toHaveProperty('load');
  });

  describe('resolveId', () => {
    it('resolves "virtual:then-routes" to "\\0virtual:then-routes"', () => {
      const plugins = thenVitePlugin();
      const plugin = plugins.find((p) => p.name === 'thenjs')!;
      const result = (plugin as any).resolveId('virtual:then-routes');
      expect(result).toBe('\0virtual:then-routes');
    });

    it('resolves "virtual:then-manifest" to "\\0virtual:then-manifest"', () => {
      const plugins = thenVitePlugin();
      const plugin = plugins.find((p) => p.name === 'thenjs')!;
      const result = (plugin as any).resolveId('virtual:then-manifest');
      expect(result).toBe('\0virtual:then-manifest');
    });

    it('resolves "virtual:then-rpc-client" to "\\0virtual:then-rpc-client"', () => {
      const plugins = thenVitePlugin();
      const plugin = plugins.find((p) => p.name === 'thenjs')!;
      const result = (plugin as any).resolveId('virtual:then-rpc-client');
      expect(result).toBe('\0virtual:then-rpc-client');
    });

    it('returns null for unknown IDs', () => {
      const plugins = thenVitePlugin();
      const plugin = plugins.find((p) => p.name === 'thenjs')!;
      const result = (plugin as any).resolveId('some-unknown-module');
      expect(result).toBeNull();
    });
  });

  describe('load', () => {
    it('returns route module content for "\\0virtual:then-routes"', async () => {
      const plugins = thenVitePlugin();
      const plugin = plugins.find((p) => p.name === 'thenjs')!;
      const result = await (plugin as any).load('\0virtual:then-routes');
      expect(typeof result).toBe('string');
      expect(result).toContain('routes');
      expect(result).toContain('apiRoutes');
      expect(result).toContain('export');
    });

    it('returns manifest module content for "\\0virtual:then-manifest"', async () => {
      const plugins = thenVitePlugin();
      const plugin = plugins.find((p) => p.name === 'thenjs')!;
      const result = await (plugin as any).load('\0virtual:then-manifest');
      expect(typeof result).toBe('string');
      expect(result).toContain('manifest');
      expect(result).toContain('export');
    });

    it('returns RPC client module content for "\\0virtual:then-rpc-client"', async () => {
      const plugins = thenVitePlugin();
      const plugin = plugins.find((p) => p.name === 'thenjs')!;
      const result = await (plugin as any).load('\0virtual:then-rpc-client');
      expect(typeof result).toBe('string');
      expect(result).toContain('createRPCClient');
      expect(result).toContain('export');
    });

    it('returns null for unknown IDs', async () => {
      const plugins = thenVitePlugin();
      const plugin = plugins.find((p) => p.name === 'thenjs')!;
      const result = await (plugin as any).load('some-unknown-module');
      expect(result).toBeNull();
    });
  });
});
