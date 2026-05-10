/**
 * Unit tests for interaction MCP tools (what_click, what_fill, etc.)
 * Uses InMemoryTransport + MCP Client — no WebSocket needed.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerTools } from '../src/tools.js';
import { registerInteractionTools } from '../src/tools-interact.js';

function createMockBridge(opts = {}) {
  const snapshot = opts.snapshot || {
    signals: [
      { id: 1, name: 'count', value: 42 },
      { id: 2, name: 'name', value: 'hello' },
      { id: 3, name: 'status', value: 'idle' },
    ],
    effects: [
      { id: 1, name: 'renderCounter', depSignalIds: [1], runCount: 5, lastRunAt: Date.now() },
    ],
    components: [
      { id: 1, name: 'App' },
      { id: 2, name: 'Counter' },
      { id: 3, name: 'Form' },
    ],
    errors: [],
  };

  let connected = opts.connected !== false;
  const commandHandler = opts.commandHandler || null;

  return {
    isConnected: () => connected,
    getSnapshot: () => snapshot,
    refreshSnapshot: async () => snapshot,
    getOrRefreshSnapshot: async () => snapshot,
    getEvents: () => [],
    getErrors: () => [],
    saveBaseline: () => true,
    getBaseline: () => snapshot,
    sendCommand: async (command, args, timeout) => {
      if (commandHandler) return commandHandler(command, args, timeout);

      // Default mock responses for interaction commands
      switch (command) {
        case 'click':
          if (args.text === 'NOT_FOUND') {
            return { error: 'No element found with text "NOT_FOUND"', suggestion: 'Use what_page_map.' };
          }
          return {
            clicked: true,
            element: {
              tag: 'button',
              text: args.text || 'Submit',
              id: 'btn-1',
            },
            matched: `text="${args.text || 'Submit'}"`,
            changes: {
              signalsChanged: [
                { id: 1, name: 'count', previousValue: 42, currentValue: 43 },
              ],
              componentsAdded: [],
              componentsRemoved: [],
              effectsTriggered: [],
            },
            currentPath: '/',
            navigated: false,
          };

        case 'fill':
          if (args.label === 'NOT_FOUND') {
            return { error: 'No input found matching: label="NOT_FOUND"', suggestion: 'Use what_page_map.' };
          }
          if (args.inputs) {
            return {
              filled: true,
              mode: 'multi',
              results: Object.entries(args.inputs).map(([key, val]) => ({
                field: key, filled: true, tag: 'input', type: 'text',
              })),
              filledCount: Object.keys(args.inputs).length,
              failedCount: 0,
            };
          }
          return {
            filled: true,
            element: { tag: 'input', type: 'text', name: args.name || 'email' },
            matched: args.label ? `label="${args.label}"` : args.name ? `name="${args.name}"` : `placeholder="${args.placeholder}"`,
            previousValue: '',
            currentValue: args.value,
            validation: { valid: true },
          };

        case 'interact':
          switch (args.action) {
            case 'submit_form':
              return { action: 'submit_form', submitted: true, formMethod: 'post', currentPath: '/' };
            case 'select_option':
              return {
                action: 'select_option', selected: true,
                previousValue: 'us', currentValue: args.value || 'uk',
                selectedText: 'United Kingdom',
              };
            case 'toggle':
              return {
                action: 'toggle', toggled: true,
                previousState: false, currentState: true,
                element: { tag: 'input', type: 'checkbox' },
              };
            case 'scroll_to':
              return {
                action: 'scroll_to', scrolled: true,
                elementRect: { x: 100, y: 300, w: 400, h: 200 },
                viewportPosition: 'visible',
              };
            case 'hover':
              return {
                action: 'hover', hovered: true,
                element: { tag: 'button', text: args.text || 'Menu' },
              };
            case 'type':
              return {
                action: 'type', typed: true,
                text: args.value || args.text || 'hello',
                currentValue: args.value || args.text || 'hello',
              };
            case 'clear':
              return { action: 'clear', cleared: true, previousValue: 'old value' };
            case 'focus':
              return {
                action: 'focus', focused: true,
                element: { tag: 'input', id: 'email' },
                isActiveElement: true,
              };
            default:
              return { error: `Unknown action: ${args.action}` };
          }

        case 'assert': {
          const assertions = [];
          if (args.text != null) {
            assertions.push({
              type: 'text', expected: args.text,
              found: args.text !== 'NOT_ON_PAGE',
              pass: args.text !== 'NOT_ON_PAGE',
            });
          }
          if (args.signalId != null || args.signalName != null) {
            const sig = snapshot.signals.find(s =>
              args.signalId != null ? s.id === args.signalId : s.name === args.signalName
            );
            if (sig) {
              const pass = args.value !== undefined
                ? JSON.stringify(sig.value) === JSON.stringify(args.value)
                : true;
              assertions.push({
                type: 'signal', signalId: sig.id, signalName: sig.name,
                currentValue: sig.value, expectedValue: args.value, pass,
              });
            } else {
              assertions.push({
                type: 'signal', pass: false,
                error: `Signal not found`,
              });
            }
          }
          if (args.route != null) {
            assertions.push({
              type: 'route', expected: args.route, actual: '/',
              pass: args.route === '/',
            });
          }
          if (args.selector != null) {
            const count = args.selector === '.error' ? 0 : 3;
            assertions.push({
              type: 'selector', selector: args.selector, matchedCount: count,
              expectedCount: args.count, pass: args.count != null ? count === args.count : count > 0,
            });
          }
          const allPassed = assertions.every(a => a.pass);
          return {
            pass: allPassed, assertions,
            totalAssertions: assertions.length,
            passed: assertions.filter(a => a.pass).length,
            failed: assertions.filter(a => !a.pass).length,
            summary: allPassed ? `All ${assertions.length} assertion(s) passed.` : `Some assertions failed.`,
          };
        }

        case 'wait':
          return {
            conditionMet: true, elapsed: 150, timedOut: false,
            lastState: args.text ? { text: args.text, found: true } : { idle: true },
            summary: 'Condition met after 150ms.',
          };

        case 'enhanced-page-map':
          return {
            viewport: { width: 1280, height: 720 },
            currentPath: '/',
            interactives: [
              {
                tag: 'button', text: 'Add Task', testId: 'add-task',
                interactWith: 'what_click', clickArgs: { testId: 'add-task' },
                rect: { x: 100, y: 200, w: 80, h: 32 },
              },
              {
                tag: 'input', type: 'text', name: 'task-input', placeholder: 'Enter task...',
                interactWith: 'what_fill', fillArgs: { name: 'task-input' },
                rect: { x: 100, y: 150, w: 300, h: 32 },
              },
              {
                tag: 'a', text: 'About', href: '/about',
                interactWith: 'what_click', clickArgs: { text: 'About' },
                rect: { x: 400, y: 10, w: 60, h: 20 },
              },
            ],
            forms: [
              {
                id: 'task-form', method: 'post',
                fields: [
                  { tag: 'input', type: 'text', name: 'task-input', placeholder: 'Enter task...' },
                ],
                fieldCount: 1,
              },
            ],
            landmarks: [
              { tag: 'main', role: 'main', text: 'Task App', rect: { x: 0, y: 60, w: 1280, h: 660 } },
            ],
            headings: [
              { level: 1, text: 'Task Manager' },
            ],
            components: [
              { id: 1, name: 'App', rect: { x: 0, y: 0, w: 1280, h: 720 }, interactiveChildren: { buttons: 1, inputs: 1, links: 1 } },
            ],
            totalElements: 7,
            summary: '3 interactive elements, 1 forms, 1 landmarks, 1 headings, 1 components',
          };

        default:
          return { error: `Unknown command: ${command}` };
      }
    },
    close: () => {},
    _setConnected: (v) => { connected = v; },
  };
}

async function setupMcp(bridgeOpts) {
  const bridge = createMockBridge(bridgeOpts);
  const server = new McpServer({ name: 'test-interact', version: '0.1.0' });
  registerTools(server, bridge);
  registerInteractionTools(server, bridge);

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

describe('Interaction tools (what_click, what_fill, what_interact, what_assert, what_wait)', () => {
  let client, server, bridge;

  afterEach(async () => {
    try { await client?.close(); } catch {}
    try { await server?.close(); } catch {}
  });

  // =========================================================================
  // what_click
  // =========================================================================

  describe('what_click', () => {
    it('clicks by text and returns changes', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_click', { text: 'Submit' });
      assert.equal(parsed.clicked, true);
      assert.ok(parsed.summary, 'should include summary');
      assert.ok(parsed.summary.includes('Submit'), 'summary should mention element');
      assert.ok(parsed.changes, 'should include changes');
      assert.equal(parsed.changes.signalsChanged.length, 1);
      assert.equal(parsed.changes.signalsChanged[0].name, 'count');
    });

    it('returns error for non-existent element', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_click', { text: 'NOT_FOUND' });
      assert.ok(parsed.error, 'should return error');
    });

    it('accepts ariaLabel selector', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_click', { ariaLabel: 'Close dialog' });
      assert.equal(parsed.clicked, true);
    });

    it('accepts testId selector', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_click', { testId: 'add-task' });
      assert.equal(parsed.clicked, true);
    });

    it('returns noConnection when bridge disconnected', async () => {
      ({ client, server, bridge } = await setupMcp({ connected: false }));
      const { parsed } = await callTool(client, 'what_click', { text: 'Submit' });
      assert.equal(parsed.error, 'No browser connected');
    });

    it('errors when no selector provided', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_click', {});
      assert.ok(parsed.error);
      assert.ok(parsed.error.includes('No selector provided'));
    });
  });

  // =========================================================================
  // what_fill
  // =========================================================================

  describe('what_fill', () => {
    it('fills by label', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_fill', {
        label: 'Email', value: 'test@example.com',
      });
      assert.equal(parsed.filled, true);
      assert.ok(parsed.summary.includes('Email'), 'summary mentions label');
    });

    it('fills by name', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_fill', {
        name: 'password', value: 'secret123',
      });
      assert.equal(parsed.filled, true);
      assert.ok(parsed.matched.includes('name='));
    });

    it('multi-fill mode fills multiple fields', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_fill', {
        inputs: { email: 'test@test.com', password: 'secret' },
      });
      assert.equal(parsed.filled, true);
      assert.equal(parsed.mode, 'multi');
      assert.equal(parsed.filledCount, 2);
      assert.equal(parsed.failedCount, 0);
    });

    it('returns error for non-existent input', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_fill', {
        label: 'NOT_FOUND', value: 'test',
      });
      assert.ok(parsed.error);
    });

    it('errors when no selector provided', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_fill', { value: 'test' });
      assert.ok(parsed.error);
    });

    it('errors when no value provided for single fill', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_fill', { label: 'Email' });
      assert.ok(parsed.error);
    });

    it('returns noConnection when disconnected', async () => {
      ({ client, server, bridge } = await setupMcp({ connected: false }));
      const { parsed } = await callTool(client, 'what_fill', {
        label: 'Email', value: 'test@test.com',
      });
      assert.equal(parsed.error, 'No browser connected');
    });
  });

  // =========================================================================
  // what_interact
  // =========================================================================

  describe('what_interact', () => {
    it('submits a form', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_interact', {
        action: 'submit_form', componentId: 3,
      });
      assert.equal(parsed.submitted, true);
      assert.ok(parsed.summary.includes('submitted'));
    });

    it('selects a dropdown option', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_interact', {
        action: 'select_option', label: 'Country', value: 'uk',
      });
      assert.equal(parsed.selected, true);
      assert.equal(parsed.currentValue, 'uk');
      assert.ok(parsed.summary.includes('United Kingdom'));
    });

    it('toggles a checkbox', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_interact', {
        action: 'toggle', text: 'Dark Mode',
      });
      assert.equal(parsed.toggled, true);
      assert.equal(parsed.previousState, false);
      assert.equal(parsed.currentState, true);
    });

    it('scrolls to an element', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_interact', {
        action: 'scroll_to', componentId: 2,
      });
      assert.equal(parsed.scrolled, true);
      assert.equal(parsed.viewportPosition, 'visible');
    });

    it('hovers over an element', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_interact', {
        action: 'hover', text: 'Menu',
      });
      assert.equal(parsed.hovered, true);
    });

    it('types text', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_interact', {
        action: 'type', value: 'hello world',
      });
      assert.equal(parsed.typed, true);
      assert.equal(parsed.text, 'hello world');
    });

    it('clears a field', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_interact', {
        action: 'clear', label: 'Email',
      });
      assert.equal(parsed.cleared, true);
      assert.equal(parsed.previousValue, 'old value');
    });

    it('focuses an element', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_interact', {
        action: 'focus', label: 'Email',
      });
      assert.equal(parsed.focused, true);
      assert.equal(parsed.isActiveElement, true);
    });

    it('returns noConnection when disconnected', async () => {
      ({ client, server, bridge } = await setupMcp({ connected: false }));
      const { parsed } = await callTool(client, 'what_interact', {
        action: 'toggle', text: 'Dark Mode',
      });
      assert.equal(parsed.error, 'No browser connected');
    });
  });

  // =========================================================================
  // what_assert
  // =========================================================================

  describe('what_assert', () => {
    it('asserts text exists on page', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_assert', { text: 'Welcome' });
      assert.equal(parsed.pass, true);
      assert.equal(parsed.totalAssertions, 1);
    });

    it('fails when text is not on page', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_assert', { text: 'NOT_ON_PAGE' });
      assert.equal(parsed.pass, false);
      assert.equal(parsed.failed, 1);
    });

    it('asserts signal value', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_assert', {
        signalName: 'count', value: 42,
      });
      assert.equal(parsed.pass, true);
    });

    it('fails on wrong signal value', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_assert', {
        signalName: 'count', value: 999,
      });
      assert.equal(parsed.pass, false);
    });

    it('asserts current route', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_assert', { route: '/' });
      assert.equal(parsed.pass, true);
    });

    it('fails on wrong route', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_assert', { route: '/dashboard' });
      assert.equal(parsed.pass, false);
    });

    it('asserts selector count', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_assert', {
        selector: '.error', count: 0,
      });
      assert.equal(parsed.pass, true);
    });

    it('errors when no assertion provided', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_assert', {});
      assert.ok(parsed.error);
    });

    it('returns noConnection when disconnected', async () => {
      ({ client, server, bridge } = await setupMcp({ connected: false }));
      const { parsed } = await callTool(client, 'what_assert', { text: 'Welcome' });
      assert.equal(parsed.error, 'No browser connected');
    });
  });

  // =========================================================================
  // what_wait
  // =========================================================================

  describe('what_wait', () => {
    it('waits for text to appear', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_wait', {
        text: 'Loaded', timeout: 1000,
      });
      assert.equal(parsed.conditionMet, true);
      assert.equal(parsed.timedOut, false);
    });

    it('waits for idle state', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_wait', {
        idle: true, timeout: 1000,
      });
      assert.equal(parsed.conditionMet, true);
    });

    it('errors when no condition provided', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_wait', {});
      assert.ok(parsed.error);
    });

    it('returns noConnection when disconnected', async () => {
      ({ client, server, bridge } = await setupMcp({ connected: false }));
      const { parsed } = await callTool(client, 'what_wait', { text: 'Loading', gone: true });
      assert.equal(parsed.error, 'No browser connected');
    });
  });

  // =========================================================================
  // what_page_map_interactive
  // =========================================================================

  describe('what_page_map_interactive', () => {
    it('returns interactive elements with interaction hints', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_page_map_interactive');
      assert.ok(parsed.interactives, 'should include interactives');
      assert.equal(parsed.interactives.length, 3);

      // Check button has clickArgs
      const button = parsed.interactives.find(i => i.tag === 'button');
      assert.ok(button, 'should have a button');
      assert.equal(button.interactWith, 'what_click');
      assert.ok(button.clickArgs, 'button should have clickArgs');
      assert.equal(button.clickArgs.testId, 'add-task');

      // Check input has fillArgs
      const input = parsed.interactives.find(i => i.tag === 'input');
      assert.ok(input, 'should have an input');
      assert.equal(input.interactWith, 'what_fill');
      assert.ok(input.fillArgs, 'input should have fillArgs');
    });

    it('returns forms with fields', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_page_map_interactive');
      assert.ok(parsed.forms, 'should include forms');
      assert.equal(parsed.forms.length, 1);
      assert.equal(parsed.forms[0].fieldCount, 1);
    });

    it('returns components with interactive child counts', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_page_map_interactive');
      assert.ok(parsed.components, 'should include components');
      assert.equal(parsed.components.length, 1);
      const comp = parsed.components[0];
      assert.ok(comp.interactiveChildren, 'should have interactiveChildren');
      assert.equal(comp.interactiveChildren.buttons, 1);
    });

    it('includes interaction guide', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_page_map_interactive');
      assert.ok(parsed.interactionGuide, 'should include interactionGuide');
      assert.ok(parsed.interactionGuide.clickButton);
      assert.ok(parsed.interactionGuide.fillInput);
    });

    it('includes summary with element counts', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_page_map_interactive');
      assert.ok(parsed.summary, 'should include summary');
      assert.ok(parsed.summary.includes('button'), 'summary should mention buttons');
      assert.ok(parsed.summary.includes('input'), 'summary should mention inputs');
      assert.ok(parsed.summary.includes('link'), 'summary should mention links');
    });

    it('returns noConnection when disconnected', async () => {
      ({ client, server, bridge } = await setupMcp({ connected: false }));
      const { parsed } = await callTool(client, 'what_page_map_interactive');
      assert.equal(parsed.error, 'No browser connected');
    });
  });
});
