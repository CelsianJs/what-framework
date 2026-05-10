/**
 * Interaction MCP tools for what-devtools-mcp.
 * 6 tools: click, fill, interact, assert, wait, enhanced page_map.
 *
 * These are the "Playwright-killer" tools — semantic page interaction
 * that leverages What Framework's component/signal knowledge.
 * Every action reports WHAT CHANGED (signals, components, effects),
 * not just "I clicked the element."
 */

import { z } from 'zod';

export function registerInteractionTools(server, bridge) {

  // ---------------------------------------------------------------------------
  // Helper responses
  // ---------------------------------------------------------------------------

  function noConnection(tool) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: 'No browser connected',
          summary: `Cannot reach browser for ${tool}.`,
          nextSteps: [
            'Ensure your What Framework app is running with the devtools-mcp Vite plugin enabled.',
            'Or call connectDevToolsMCP() manually in the browser console.',
          ],
        }, null, 2),
      }],
      isError: true,
    };
  }

  function errorResponse(message, nextSteps) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: message,
          summary: message,
          nextSteps: nextSteps || ['Check the arguments and try again.'],
        }, null, 2),
      }],
      isError: true,
    };
  }

  function ok(data) {
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    };
  }

  // ---------------------------------------------------------------------------
  // Tool 1 — what_click
  // ---------------------------------------------------------------------------

  server.tool(
    'what_click',
    'Click any interactive element by text, ARIA label, test-id, component ID, or role. Returns what changed: signal updates, component mounts/unmounts, navigation. More powerful than Playwright — uses semantic matching, not CSS selectors.',
    {
      text: z.string().optional().describe('Click element with this text (button text, link text). Matches interactives first, then any element.'),
      ariaLabel: z.string().optional().describe('Click element with this aria-label attribute'),
      testId: z.string().optional().describe('Click element with this data-testid attribute'),
      componentId: z.number().optional().describe('Scope the search to this component (from what_components)'),
      role: z.string().optional().describe('Click element with this ARIA role (e.g. "button", "link", "tab")'),
      index: z.number().optional().describe('If multiple elements match, click the Nth one (0-based, default: 0)'),
    },
    async ({ text, ariaLabel, testId, componentId, role, index }) => {
      if (!bridge.isConnected()) return noConnection('what_click');

      // At least one selector required
      if (!text && !ariaLabel && !testId && !role && componentId == null) {
        return errorResponse(
          'No selector provided. Specify at least one of: text, ariaLabel, testId, role, componentId.',
          ['Use what_page_map to see available interactive elements.']
        );
      }

      try {
        const result = await bridge.sendCommand('click', {
          text, ariaLabel, testId, componentId, role, index,
          _prevPath: undefined, // Set by the browser handler
        }, 10000);

        if (result.error) {
          return errorResponse(result.error, [
            result.suggestion || 'Use what_page_map to see available interactive elements and their labels.',
          ]);
        }

        // Build summary
        const parts = [];
        if (result.clicked) parts.push(`Clicked ${result.element?.tag || 'element'} (${result.matched})`);
        if (result.changes?.signalsChanged?.length) {
          const sigChanges = result.changes.signalsChanged.map(s =>
            `${s.name}: ${JSON.stringify(s.previousValue)} -> ${JSON.stringify(s.currentValue)}`
          );
          parts.push(`Signals changed: ${sigChanges.join(', ')}`);
        }
        if (result.changes?.componentsAdded?.length) {
          parts.push(`Components mounted: ${result.changes.componentsAdded.map(c => c.name).join(', ')}`);
        }
        if (result.changes?.componentsRemoved?.length) {
          parts.push(`Components unmounted: ${result.changes.componentsRemoved.map(c => c.id).join(', ')}`);
        }
        if (result.navigated) parts.push(`Navigated to ${result.currentPath}`);

        const summary = parts.join('. ') + '.';

        return ok({ summary, ...result });
      } catch (e) {
        return errorResponse(`Click failed: ${e.message}`, [
          'Check what_connection_status.',
          'Use what_page_map to verify the element exists.',
        ]);
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Tool 2 — what_fill
  // ---------------------------------------------------------------------------

  server.tool(
    'what_fill',
    'Fill form inputs by label, name, or placeholder. Can fill single fields or all inputs in a component at once. Returns validation state and signal changes.',
    {
      label: z.string().optional().describe('Find input by its <label> text, aria-label, or placeholder'),
      name: z.string().optional().describe('Find input by its name attribute'),
      placeholder: z.string().optional().describe('Find input by its placeholder text'),
      value: z.string().optional().describe('Value to set (for single-field mode)'),
      componentId: z.number().optional().describe('Scope to this component'),
      inputs: z.record(z.string(), z.string()).optional().describe('Multi-fill: object mapping field names/IDs to values. Example: {"email": "test@test.com", "password": "secret"}'),
    },
    async ({ label, name, placeholder, value, componentId, inputs }) => {
      if (!bridge.isConnected()) return noConnection('what_fill');

      // Validate: need either single-field or multi-field args
      if (!inputs && !label && !name && !placeholder) {
        return errorResponse(
          'No field selector provided. Specify label, name, placeholder, or inputs (multi-fill).',
          ['Use what_page_map to see available form fields with their labels and names.']
        );
      }

      if (!inputs && value === undefined) {
        return errorResponse(
          'No value provided. Specify value for single-field fill, or use inputs for multi-fill.',
          ['Example: what_fill({label: "Email", value: "test@test.com"})']
        );
      }

      try {
        const result = await bridge.sendCommand('fill', {
          label, name, placeholder, value, componentId, inputs,
        }, 10000);

        if (result.error) {
          return errorResponse(result.error, [
            result.suggestion || 'Use what_page_map to see available form fields.',
          ]);
        }

        // Build summary
        let summary;
        if (result.mode === 'multi') {
          summary = `Filled ${result.filledCount} of ${result.results?.length || 0} fields.`;
          if (result.failedCount > 0) {
            const failed = result.results.filter(r => !r.filled).map(r => r.field);
            summary += ` Failed: ${failed.join(', ')}.`;
          }
        } else {
          summary = `Filled ${result.element?.tag || 'input'} (${result.matched}): "${result.previousValue || ''}" -> "${result.currentValue || ''}".`;
          if (result.validation && !result.validation.valid) {
            const issues = Object.entries(result.validation)
              .filter(([k, v]) => k !== 'valid' && v === true)
              .map(([k]) => k);
            summary += ` Validation issues: ${issues.join(', ')}.`;
          }
        }

        return ok({ summary, ...result });
      } catch (e) {
        return errorResponse(`Fill failed: ${e.message}`, ['Check what_connection_status.']);
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Tool 3 — what_interact
  // ---------------------------------------------------------------------------

  server.tool(
    'what_interact',
    'Perform high-level page interactions: submit forms, select dropdown options, toggle checkboxes/switches, scroll to elements, hover, type text, clear fields, or focus elements.',
    {
      action: z.enum([
        'submit_form', 'select_option', 'toggle', 'scroll_to', 'hover', 'type', 'clear', 'focus',
      ]).describe('The interaction to perform'),
      componentId: z.number().optional().describe('Scope to this component'),
      label: z.string().optional().describe('Target element by label text'),
      text: z.string().optional().describe('Target element by visible text, or text to type'),
      value: z.string().optional().describe('Value for select_option or text for type action'),
      name: z.string().optional().describe('Target element by name attribute (for clear action)'),
    },
    async ({ action, componentId, label, text, value, name }) => {
      if (!bridge.isConnected()) return noConnection('what_interact');

      try {
        const result = await bridge.sendCommand('interact', {
          action, componentId, label, text, value, name,
        }, 10000);

        if (result.error) {
          return errorResponse(result.error, [
            'Use what_page_map to see available interactive elements.',
            result.availableOptions ? `Available options: ${JSON.stringify(result.availableOptions)}` : null,
          ].filter(Boolean));
        }

        // Build summary per action type
        let summary = `Action "${action}" completed.`;
        switch (action) {
          case 'submit_form':
            summary = `Form submitted${result.formAction ? ` (action: ${result.formAction})` : ''}.`;
            break;
          case 'select_option':
            summary = `Selected "${result.selectedText || result.currentValue}" (was "${result.previousValue}").`;
            break;
          case 'toggle':
            summary = `Toggled from ${result.previousState} to ${result.currentState}.`;
            break;
          case 'scroll_to':
            summary = `Scrolled to element. Position: ${result.viewportPosition}.`;
            break;
          case 'hover':
            summary = `Hovering over ${result.element?.tag || 'element'}${result.element?.text ? ` ("${result.element.text}")` : ''}.`;
            break;
          case 'type':
            summary = `Typed "${result.text}". Current value: "${result.currentValue}".`;
            break;
          case 'clear':
            summary = `Cleared field (was "${result.previousValue}").`;
            break;
          case 'focus':
            summary = `Focused ${result.element?.tag || 'element'}.`;
            break;
        }

        return ok({ summary, ...result });
      } catch (e) {
        return errorResponse(`Interact failed: ${e.message}`, ['Check what_connection_status.']);
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Tool 4 — what_assert
  // ---------------------------------------------------------------------------

  server.tool(
    'what_assert',
    'Verify page state without screenshots. Check visible text, signal values, component existence, element counts, or current route. Returns pass/fail for each assertion.',
    {
      text: z.string().optional().describe('Assert this text exists on the page'),
      visible: z.boolean().optional().describe('If true, text must also be visible (not hidden via CSS)'),
      componentId: z.number().optional().describe('Assert this component is mounted (or combine with signalName/value to check its signals)'),
      signalName: z.string().optional().describe('Assert a signal by name exists or has a specific value'),
      signalId: z.number().optional().describe('Assert a signal by ID exists or has a specific value'),
      value: z.any().optional().describe('Expected value for the signal assertion'),
      selector: z.string().optional().describe('CSS selector to count matching elements'),
      count: z.number().optional().describe('Expected number of elements matching selector'),
      route: z.string().optional().describe('Assert the current route path'),
      exists: z.boolean().optional().default(true).describe('For component assertions: true = should exist, false = should not exist'),
    },
    async ({ text, visible, componentId, signalName, signalId, value, selector, count, route, exists }) => {
      if (!bridge.isConnected()) return noConnection('what_assert');

      // Must provide at least one assertion
      if (text == null && componentId == null && signalName == null && signalId == null && selector == null && route == null) {
        return errorResponse(
          'No assertion specified. Provide at least one of: text, componentId, signalName, signalId, selector, route.',
          ['Example: what_assert({text: "Welcome", visible: true})']
        );
      }

      try {
        const result = await bridge.sendCommand('assert', {
          text, visible, componentId, signalName, signalId, value, selector, count, route, exists,
        }, 10000);

        if (result.error) {
          return errorResponse(result.error);
        }

        return ok(result);
      } catch (e) {
        return errorResponse(`Assert failed: ${e.message}`, ['Check what_connection_status.']);
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Tool 5 — what_wait
  // ---------------------------------------------------------------------------

  server.tool(
    'what_wait',
    'Wait for a condition to be met: text to appear/disappear, component to mount/unmount, signal to reach a value, or app to become idle. Returns what happened during the wait.',
    {
      text: z.string().optional().describe('Wait for this text to appear (or disappear if gone=true)'),
      gone: z.boolean().optional().describe('If true, wait for text to disappear instead of appear'),
      componentId: z.number().optional().describe('Wait for this component to mount (or unmount if mounted=false)'),
      mounted: z.boolean().optional().default(true).describe('Wait for component to be mounted (true) or unmounted (false)'),
      signalId: z.number().optional().describe('Wait for this signal to reach a specific value'),
      signalName: z.string().optional().describe('Wait for this named signal to reach a specific value'),
      value: z.any().optional().describe('The value to wait for (used with signalId or signalName)'),
      idle: z.boolean().optional().describe('Wait until no reactive activity for 200ms'),
      timeout: z.number().optional().default(5000).describe('Max wait time in ms (default: 5000, max: 30000)'),
    },
    async ({ text, gone, componentId, mounted, signalId, signalName, value, idle, timeout }) => {
      if (!bridge.isConnected()) return noConnection('what_wait');

      // Must provide at least one condition
      if (text == null && componentId == null && signalId == null && signalName == null && !idle) {
        return errorResponse(
          'No wait condition specified. Provide one of: text, componentId, signalId, signalName, idle.',
          ['Example: what_wait({text: "Loading", gone: true})']
        );
      }

      const clampedTimeout = Math.min(Math.max(timeout || 5000, 100), 30000);

      try {
        const result = await bridge.sendCommand('wait', {
          text, gone, componentId, mounted, signalId, signalName, value, idle,
          timeout: clampedTimeout,
        }, clampedTimeout + 2000); // Give the bridge extra time beyond the wait timeout

        if (result.error) {
          return errorResponse(result.error);
        }

        return ok(result);
      } catch (e) {
        // Timeout on bridge side is expected — the wait itself handles timeouts
        if (e.message?.includes('timed out')) {
          return ok({
            conditionMet: false,
            timedOut: true,
            summary: `Wait timed out after ${clampedTimeout}ms.`,
          });
        }
        return errorResponse(`Wait failed: ${e.message}`, ['Check what_connection_status.']);
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Tool 6 — what_page_map (enhanced version with interaction hints)
  // ---------------------------------------------------------------------------

  server.tool(
    'what_page_map_interactive',
    'Get a complete map of everything you can interact with on the page. For each element, shows the exact tool and arguments to use. Includes forms with all fields, buttons with suggested click args, links with targets, selects with options. The "what can I do on this page?" tool.',
    {
      maxElements: z.number().optional().default(300).describe('Max elements to include (default: 300)'),
    },
    async ({ maxElements }) => {
      if (!bridge.isConnected()) return noConnection('what_page_map_interactive');

      try {
        const result = await bridge.sendCommand('enhanced-page-map', {
          maxElements: maxElements || 300,
        }, 10000);

        if (result.error) {
          return errorResponse(result.error);
        }

        const { viewport, currentPath, interactives, forms, landmarks, headings, components, totalElements } = result;

        // Build a rich summary
        const buttonCount = interactives.filter(i => i.tag === 'button' || i.role === 'button').length;
        const inputCount = interactives.filter(i => i.tag === 'input' || i.tag === 'textarea').length;
        const linkCount = interactives.filter(i => i.tag === 'a').length;
        const selectCount = interactives.filter(i => i.tag === 'select').length;

        const summary = `Page "${currentPath}" (${viewport.width}x${viewport.height}). ` +
          `${buttonCount} buttons, ${inputCount} inputs, ${linkCount} links, ${selectCount} selects. ` +
          `${forms.length} forms. ${components.length} WhatFW components. ` +
          `${totalElements} total elements mapped.`;

        return ok({
          summary,
          viewport,
          currentPath,
          interactives,
          forms,
          landmarks,
          headings,
          components,
          totalElements,
          interactionGuide: {
            clickButton: 'what_click({text: "Button Text"})',
            fillInput: 'what_fill({label: "Field Label", value: "text"})',
            selectOption: 'what_interact({action: "select_option", label: "Dropdown", value: "option"})',
            submitForm: 'what_interact({action: "submit_form", componentId: N})',
            toggleCheckbox: 'what_interact({action: "toggle", text: "Checkbox Label"})',
          },
        });
      } catch (e) {
        return errorResponse(`Page map failed: ${e.message}`, ['Check what_connection_status.']);
      }
    }
  );
}
