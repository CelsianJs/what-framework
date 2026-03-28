/**
 * Unit tests for MCP tools against a mock bridge.
 * Uses InMemoryTransport + MCP Client — no WebSocket needed.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerTools } from '../src/tools.js';
import { registerExtendedTools } from '../src/tools-extended.js';

function createMockBridge(opts = {}) {
  const snapshot = opts.snapshot || {
    signals: [
      { id: 1, name: 'count', value: 42 },
      { id: 2, name: 'name', value: 'hello' },
      { id: 3, name: 'internal_props', value: {} },
    ],
    effects: [
      { id: 1, name: 'renderCounter', depSignalIds: [1], runCount: 5, lastRunAt: Date.now() },
      { id: 2, name: 'logEffect', depSignalIds: [2], runCount: 1, lastRunAt: Date.now() },
    ],
    components: [
      { id: 1, name: 'App' },
      { id: 2, name: 'Counter' },
    ],
    errors: opts.errors || [],
  };

  const events = opts.events || [];
  const errors = opts.errorLog || [];
  let connected = opts.connected !== false;
  let commandHandler = opts.commandHandler || null;

  return {
    isConnected: () => connected,
    getSnapshot: () => snapshot,
    refreshSnapshot: async () => snapshot,
    getOrRefreshSnapshot: async () => snapshot,
    getCacheSnapshot: async () => opts.cache || [],
    getEvents: (since) => since ? events.filter(e => e.timestamp > since) : events,
    getErrors: (since) => since ? errors.filter(e => e.timestamp > since) : errors,
    saveBaseline: () => true,
    getBaseline: () => snapshot,
    sendCommand: async (command, args) => {
      if (commandHandler) return commandHandler(command, args);
      if (command === 'set-signal') {
        const sig = snapshot.signals.find(s => s.id === args.signalId);
        if (!sig) return { error: `Signal ${args.signalId} not found` };
        const prev = sig.value;
        sig.value = args.value;
        return { previous: prev, current: args.value };
      }
      if (command === 'invalidate-cache') return { success: true, key: args.key };
      if (command === 'visual-inspect') {
        const cid = args.componentId;
        const comp = snapshot.components.find(c => c.id === cid);
        if (!comp) return { error: `Component ${cid} not found` };
        return {
          componentName: comp.name,
          componentId: cid,
          boundingRect: { x: 100, y: 50, width: 300, height: 200 },
          styles: {
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: 'rgb(255, 255, 255)',
            color: 'rgb(0, 0, 0)',
            fontSize: '16px',
            padding: '16px',
          },
          textContent: 'Count: 5 Increment Decrement',
          childElements: { button: 2 },
          totalChildren: 3,
          accessibility: { role: 'group' },
          layout: 'flex column with 3 children',
          viewport: { width: 1280, height: 720 },
        };
      }
      if (command === 'component-screenshot') {
        const cid = args.componentId;
        const comp = snapshot.components.find(c => c.id === cid);
        if (!comp) return { error: `Component ${cid} not found` };
        return {
          base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          format: args.format || 'jpeg',
          mimeType: args.format === 'png' ? 'image/png' : 'image/jpeg',
          width: 300,
          height: 200,
          sizeBytes: 1234,
          componentName: comp.name,
        };
      }
      if (command === 'page-map') {
        return {
          viewport: { width: 1280, height: 720 },
          landmarks: [
            { tag: 'header', text: 'My App', rect: { x: 0, y: 0, w: 1280, h: 60 } },
            { tag: 'main', role: 'main', text: 'Counter', rect: { x: 0, y: 60, w: 1280, h: 660 } },
          ],
          interactives: [
            { tag: 'button', label: 'Increment', rect: { x: 100, y: 100, w: 80, h: 32 } },
            { tag: 'button', label: 'Decrement', rect: { x: 200, y: 100, w: 80, h: 32 } },
          ],
          headings: [
            { level: 1, text: 'My App' },
          ],
          components: [
            { id: 1, name: 'Counter', rect: { x: 100, y: 50, w: 300, h: 200 } },
          ],
          totalElements: 6,
        };
      }
      return { error: `Unknown command: ${command}` };
    },
    close: () => {},
    _setConnected: (v) => { connected = v; },
  };
}

async function setupMcp(bridgeOpts) {
  const bridge = createMockBridge(bridgeOpts);
  const server = new McpServer({ name: 'test', version: '0.1.0' });
  registerTools(server, bridge);
  registerExtendedTools(server, bridge);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.1.0' });

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  return { client, server, bridge };
}

async function callTool(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content[0]?.text;
  return { ...result, parsed: text ? JSON.parse(text) : null };
}

describe('what-devtools-mcp tools', () => {
  let client, server, bridge;

  afterEach(async () => {
    try { await client?.close(); } catch {}
    try { await server?.close(); } catch {}
  });

  describe('what_connection_status', () => {
    it('returns connected status with counts', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_connection_status');
      assert.equal(parsed.connected, true);
      assert.equal(parsed.signalCount, 3);
      assert.equal(parsed.effectCount, 2);
      assert.equal(parsed.componentCount, 2);
    });

    it('returns disconnected when no browser', async () => {
      ({ client, server, bridge } = await setupMcp({ connected: false }));
      const { parsed } = await callTool(client, 'what_connection_status');
      assert.equal(parsed.connected, false);
    });
  });

  describe('what_signals', () => {
    it('returns all signals', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_signals');
      assert.equal(parsed.count, 3);
      assert.equal(parsed.signals[0].name, 'count');
      assert.equal(parsed.signals[0].value, 42);
    });

    it('filters by name regex', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_signals', { filter: 'count' });
      assert.equal(parsed.count, 1);
      assert.equal(parsed.signals[0].name, 'count');
    });

    it('filters by ID', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_signals', { id: 2 });
      assert.equal(parsed.count, 1);
      assert.equal(parsed.signals[0].name, 'name');
    });

    it('returns error when not connected', async () => {
      ({ client, server, bridge } = await setupMcp({ connected: false }));
      const result = await callTool(client, 'what_signals');
      assert.equal(result.parsed.error, 'No browser connected');
    });
  });

  describe('what_effects', () => {
    it('returns all effects with dep info', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_effects');
      assert.equal(parsed.count, 2);
      assert.deepEqual(parsed.effects[0].depSignalIds, [1]);
      assert.equal(parsed.effects[0].runCount, 5);
    });

    it('filters by minRunCount', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_effects', { minRunCount: 3 });
      assert.equal(parsed.count, 1);
      assert.equal(parsed.effects[0].name, 'renderCounter');
    });
  });

  describe('what_errors', () => {
    it('returns captured errors', async () => {
      const now = Date.now();
      ({ client, server, bridge } = await setupMcp({
        errorLog: [
          { message: 'Test error', type: 'effect', timestamp: now - 1000 },
          { message: 'Another error', type: 'effect', timestamp: now },
        ],
      }));
      const { parsed } = await callTool(client, 'what_errors');
      assert.equal(parsed.count, 2);
    });

    it('filters by since timestamp', async () => {
      const now = Date.now();
      ({ client, server, bridge } = await setupMcp({
        errorLog: [
          { message: 'Old error', type: 'effect', timestamp: now - 5000 },
          { message: 'New error', type: 'effect', timestamp: now },
        ],
      }));
      const { parsed } = await callTool(client, 'what_errors', { since: now - 1000 });
      assert.equal(parsed.count, 1);
      assert.equal(parsed.errors[0].message, 'New error');
    });
  });

  describe('what_set_signal', () => {
    it('sets signal value and returns prev/current', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_set_signal', { signalId: 1, value: 100 });
      assert.equal(parsed.success, true);
      assert.equal(parsed.previous, 42);
      assert.equal(parsed.current, 100);
    });

    it('returns error for unknown signal', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_set_signal', { signalId: 999, value: 0 });
      assert.ok(parsed.error);
    });
  });

  describe('what_watch', () => {
    it('collects events over duration', async () => {
      const now = Date.now();
      ({ client, server, bridge } = await setupMcp({
        events: [
          { event: 'signal:updated', data: { id: 1 }, timestamp: now + 50 },
          { event: 'signal:updated', data: { id: 1 }, timestamp: now + 100 },
        ],
      }));
      const { parsed } = await callTool(client, 'what_watch', { duration: 200 });
      assert.equal(parsed.eventCount, 2);
    });
  });

  describe('what_cache', () => {
    it('returns cache entries', async () => {
      ({ client, server, bridge } = await setupMcp({
        cache: [
          { key: '/api/users', data: [{ id: 1, name: 'Alice' }], error: null, isValidating: false },
        ],
      }));
      const { parsed } = await callTool(client, 'what_cache');
      assert.equal(parsed.count, 1);
      assert.equal(parsed.entries[0].key, '/api/users');
    });
  });

  describe('what_components', () => {
    it('returns mounted components', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_components');
      assert.equal(parsed.count, 2);
      assert.equal(parsed.components[0].name, 'App');
    });
  });

  // =========================================================================
  // Visual "Sight" tools — what_look, what_screenshot, what_page_map
  // =========================================================================

  describe('what_look', () => {
    it('returns component visual info with bounding rect, styles, layout', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_look', { componentId: 2 });
      assert.equal(parsed.component, 'Counter');
      assert.ok(parsed.boundingRect, 'should include boundingRect');
      assert.equal(parsed.boundingRect.width, 300);
      assert.equal(parsed.boundingRect.height, 200);
      assert.ok(parsed.styles, 'should include styles');
      assert.equal(parsed.styles.display, 'flex');
      assert.equal(parsed.styles.fontSize, '16px');
    });

    it('summary includes component name and dimensions', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_look', { componentId: 1 });
      assert.ok(parsed.summary, 'should include summary');
      assert.ok(parsed.summary.includes('App'), 'summary should mention component name');
      assert.ok(parsed.summary.includes('300'), 'summary should mention width');
      assert.ok(parsed.summary.includes('200'), 'summary should mention height');
    });

    it('layout classification is present', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_look', { componentId: 2 });
      assert.ok(parsed.layout, 'should include layout');
      assert.ok(parsed.layout.includes('flex'), 'layout should describe flex');
    });

    it('returns error for invalid componentId', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_look', { componentId: 999 });
      assert.ok(parsed.error, 'should return error for missing component');
    });

    it('returns noConnection error when bridge disconnected', async () => {
      ({ client, server, bridge } = await setupMcp({ connected: false }));
      const { parsed } = await callTool(client, 'what_look', { componentId: 1 });
      assert.equal(parsed.error, 'No browser connected');
    });
  });

  describe('what_screenshot', () => {
    it('returns image content type with base64 data', async () => {
      ({ client, server, bridge } = await setupMcp());
      const result = await client.callTool({ name: 'what_screenshot', arguments: { componentId: 2 } });
      // what_screenshot returns two content blocks: image + text
      assert.ok(result.content.length >= 2, 'should have at least 2 content blocks');
      const imageBlock = result.content.find(c => c.type === 'image');
      const textBlock = result.content.find(c => c.type === 'text');
      assert.ok(imageBlock, 'should have an image content block');
      assert.ok(textBlock, 'should have a text content block');
      assert.ok(imageBlock.data, 'image block should have base64 data');
      assert.ok(imageBlock.mimeType.startsWith('image/'), 'mimeType should start with image/');
    });

    it('metadata includes width, height, sizeKB', async () => {
      ({ client, server, bridge } = await setupMcp());
      const result = await client.callTool({ name: 'what_screenshot', arguments: { componentId: 2 } });
      const textBlock = result.content.find(c => c.type === 'text');
      const meta = JSON.parse(textBlock.text);
      assert.ok(meta.width > 0, 'width should be positive');
      assert.ok(meta.height > 0, 'height should be positive');
      assert.ok(typeof meta.sizeKB === 'number', 'sizeKB should be a number');
      assert.ok(meta.componentName === 'Counter', 'should include component name');
    });

    it('returns error for invalid componentId', async () => {
      ({ client, server, bridge } = await setupMcp());
      const result = await client.callTool({ name: 'what_screenshot', arguments: { componentId: 999 } });
      const text = result.content[0]?.text;
      const parsed = JSON.parse(text);
      assert.ok(parsed.error, 'should return error for missing component');
    });

    it('returns noConnection error when bridge disconnected', async () => {
      ({ client, server, bridge } = await setupMcp({ connected: false }));
      const result = await client.callTool({ name: 'what_screenshot', arguments: { componentId: 1 } });
      const parsed = JSON.parse(result.content[0].text);
      assert.equal(parsed.error, 'No browser connected');
    });
  });

  describe('what_page_map', () => {
    it('returns page layout with landmarks, interactives, headings, components', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_page_map');
      assert.ok(parsed.landmarks, 'should include landmarks');
      assert.equal(parsed.landmarks.length, 2);
      assert.ok(parsed.interactives, 'should include interactives');
      assert.equal(parsed.interactives.length, 2);
      assert.ok(parsed.headings, 'should include headings');
      assert.equal(parsed.headings.length, 1);
      assert.ok(parsed.components, 'should include components');
      assert.equal(parsed.components.length, 1);
      assert.equal(parsed.components[0].name, 'Counter');
    });

    it('summary includes counts', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_page_map');
      assert.ok(parsed.summary, 'should include summary');
      assert.ok(parsed.summary.includes('2 landmarks'), 'summary should count landmarks');
      assert.ok(parsed.summary.includes('2 interactive'), 'summary should count interactives');
      assert.ok(parsed.summary.includes('1 heading'), 'summary should count headings');
      assert.ok(parsed.summary.includes('1 WhatFW component'), 'summary should count components');
    });

    it('viewport dimensions are returned', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_page_map');
      assert.ok(parsed.viewport, 'should include viewport');
      assert.equal(parsed.viewport.width, 1280);
      assert.equal(parsed.viewport.height, 720);
    });

    it('returns noConnection error when bridge disconnected', async () => {
      ({ client, server, bridge } = await setupMcp({ connected: false }));
      const { parsed } = await callTool(client, 'what_page_map');
      assert.equal(parsed.error, 'No browser connected');
    });
  });
});
