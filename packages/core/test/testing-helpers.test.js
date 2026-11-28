// what-framework/testing's event helpers, waits and DOM assertions
// (docs/API.md: "DOM events, document-wide queries, DOM assertions";
// waitFor "polls until truthy").
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM();
const { fireEvent, waitFor, waitForElementToBeRemoved, expect } = await import('../src/testing.js');

function attached(html) {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.append(host);
  return host;
}

describe('fireEvent', () => {
  it('dispatches each event, bubbling, with what it carries', () => {
    const host = attached('<form><input id="i"><button id="b" type="button">x</button></form>');
    const seen = [];
    for (const type of ['click', 'input', 'change', 'submit', 'focus', 'blur', 'keydown', 'keyup', 'mouseenter', 'mouseleave']) {
      host.addEventListener(type, (e) => seen.push([type, e.bubbles, e.key ?? null, e.target.value ?? null]), true);
    }
    const input = host.querySelector('#i');
    fireEvent.click(host.querySelector('#b'));
    fireEvent.input(input, 'typed');
    fireEvent.change(input, 'changed');
    fireEvent.submit(host.querySelector('form'));
    fireEvent.focus(input);
    fireEvent.blur(input);
    fireEvent.keyDown(input, 'Enter', { shiftKey: true });
    fireEvent.keyUp(input, 'a');
    fireEvent.mouseEnter(input);
    fireEvent.mouseLeave(input);
    const types = seen.map(([type]) => type);
    assert.deepEqual(types.filter((t) => t !== 'focus' && t !== 'blur'),
      ['click', 'input', 'input', 'change', 'submit', 'keydown', 'keyup', 'mouseenter', 'mouseleave']);
    // focus() and blur() move focus first, which fires its own focus or blur
    // event (one that does not bubble), then dispatch a bubbling one.
    assert.ok(seen.filter(([t]) => t !== 'focus' && t !== 'blur').every(([, bubbles]) => bubbles));
    assert.ok(seen.some(([t, bubbles]) => t === 'focus' && bubbles) && seen.some(([t, bubbles]) => t === 'blur' && bubbles));
    assert.equal(document.activeElement, document.body, 'blur() moved focus off the input');
    assert.deepEqual(seen.find(([t]) => t === 'change').slice(3), ['changed'], 'change sets the value, then fires input and change');
    assert.equal(seen.find(([t]) => t === 'keydown')[2], 'Enter');
    assert.equal(fireEvent.submit(host.querySelector('form')).cancelable, true);
    host.remove();
  });
});

describe('waitFor', () => {
  it('resolves with the first truthy result, polling through falsy results and throws', async () => {
    let n = 0;
    const value = await waitFor(() => {
      n++;
      if (n === 1) throw new Error('not yet');
      return n >= 3 ? `after ${n}` : null;
    }, { interval: 1 });
    assert.equal(value, 'after 3');
  });

  it('rejects after the timeout', async () => {
    await assert.rejects(waitFor(() => false, { timeout: 20, interval: 5 }), /waitFor timed out after 20ms/);
  });
});

describe('waitForElementToBeRemoved', () => {
  it('resolves once the element is gone, and rejects when it was never there or stays', async () => {
    const host = attached('<p id="gone">x</p><p id="stays">y</p>');
    setTimeout(() => host.querySelector('#gone').remove(), 5);
    await waitForElementToBeRemoved(() => host.querySelector('#gone'), { interval: 1 });
    await assert.rejects(waitForElementToBeRemoved(() => host.querySelector('#absent')), /Element not found/);
    await assert.rejects(waitForElementToBeRemoved(() => host.querySelector('#stays'), { timeout: 15, interval: 5 }), /still present after 15ms/);
    host.remove();
  });
});

describe('expect', () => {
  it('toBeInTheDocument: an element of the document, not one of a detached tree', () => {
    const host = attached('<p>x</p>');
    expect.toBeInTheDocument(host.querySelector('p'));
    const detached = document.createElement('div');
    detached.innerHTML = '<p>y</p>';
    assert.throws(() => expect.toBeInTheDocument(detached.querySelector('p')), /in the document/);
    assert.throws(() => expect.toBeInTheDocument(null), /in the document/);
    host.remove();
  });

  it('toHaveTextContent: a substring or a pattern', () => {
    const host = attached('<p>Hello world</p>');
    const p = host.querySelector('p');
    expect.toHaveTextContent(p, 'lo wo');
    expect.toHaveTextContent(p, /^Hello/);
    assert.throws(() => expect.toHaveTextContent(p, 'bye'), /Expected "Hello world" to contain "bye"/);
    assert.throws(() => expect.toHaveTextContent(null, 'x'), /not found/);
    host.remove();
  });

  it('toHaveAttribute: present, or with a value', () => {
    const host = attached('<a href="/x" data-empty="">x</a>');
    const a = host.querySelector('a');
    expect.toHaveAttribute(a, 'href');
    expect.toHaveAttribute(a, 'href', '/x');
    expect.toHaveAttribute(a, 'data-empty', '');
    assert.throws(() => expect.toHaveAttribute(a, 'href', '/y'), /to be "\/y", got "\/x"/);
    assert.throws(() => expect.toHaveAttribute(a, 'title'), /to have attribute "title"/);
    host.remove();
  });

  it('toHaveClass, toBeDisabled and toHaveValue', () => {
    const host = attached('<input class="a b" value="v" disabled><fieldset disabled><input id="in-set"></fieldset><input id="on">');
    const input = host.querySelector('input');
    expect.toHaveClass(input, 'b');
    assert.throws(() => expect.toHaveClass(input, 'c'), /class "c"/);
    expect.toBeDisabled(input);
    expect.toBeDisabled(host.querySelector('#in-set'));
    assert.throws(() => expect.toBeDisabled(host.querySelector('#on')), /disabled/);
    expect.toHaveValue(input, 'v');
    assert.throws(() => expect.toHaveValue(input, 'w'), /to be "w", got "v"/);
    host.remove();
  });

  it('toBeVisible: not hidden by itself or by an ancestor', () => {
    const host = attached('<p id="shown">x</p><p id="none" style="display:none">x</p><p id="invisible" style="visibility:hidden">x</p><p id="clear" style="opacity:0">x</p><div style="display:none"><p id="inside">x</p></div>');
    expect.toBeVisible(host.querySelector('#shown'));
    for (const id of ['none', 'invisible', 'clear', 'inside']) {
      assert.throws(() => expect.toBeVisible(host.querySelector(`#${id}`)), /visible/, id);
    }
    host.remove();
  });
});
