import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>');
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.queueMicrotask = global.queueMicrotask || ((fn) => Promise.resolve().then(fn));
global.window = dom.window;
global.getComputedStyle = dom.window.getComputedStyle;

const { signal } = await import('../src/reactive.js');
const { insert } = await import('../src/render.js');
const { configureText, _resetTextEngineForTests, _setPretextForTests, _wasMeasureHookInvoked, _resetMeasureHookInvocation } = await import('../src/text-engine.js');

describe('insert() measure hook', () => {
  beforeEach(() => {
    _resetTextEngineForTests();
    _resetMeasureHookInvocation();
    _setPretextForTests({ prepare: () => ({}), layout: () => ({}) });
  });

  it('does NOT invoke text-engine when measure mode is off (default)', () => {
    const parent = document.createElement('div');
    const count = signal(0);
    insert(parent, () => `count: ${count()}`);
    assert.equal(_wasMeasureHookInvoked(), false);
  });

  it('invokes text-engine when measure mode is on and child is a function returning text', () => {
    configureText({ measure: true });
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const count = signal(0);
    insert(parent, () => `count: ${count()}`);
    assert.equal(_wasMeasureHookInvoked(), true);
  });

  it('does NOT invoke text-engine for static text (non-function child)', () => {
    configureText({ measure: true });
    const parent = document.createElement('div');
    insert(parent, 'static text');
    assert.equal(_wasMeasureHookInvoked(), false);
  });

  it('writes the correct text to the DOM regardless of hook state', () => {
    configureText({ measure: true });
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const count = signal(0);
    insert(parent, () => `count: ${count()}`);
    assert.equal(parent.textContent, 'count: 0');
  });
});
