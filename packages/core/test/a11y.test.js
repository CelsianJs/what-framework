// Tests for What Framework - Accessibility Utilities
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { Keys, useId, useIds, onKey, onKeys } = await import('../src/a11y.js');

describe('accessibility utilities', () => {
  describe('Keys', () => {
    it('should have standard key constants', () => {
      assert.equal(Keys.Enter, 'Enter');
      assert.equal(Keys.Space, ' ');
      assert.equal(Keys.Escape, 'Escape');
      assert.equal(Keys.Tab, 'Tab');
      assert.equal(Keys.ArrowUp, 'ArrowUp');
      assert.equal(Keys.ArrowDown, 'ArrowDown');
      assert.equal(Keys.ArrowLeft, 'ArrowLeft');
      assert.equal(Keys.ArrowRight, 'ArrowRight');
      assert.equal(Keys.Home, 'Home');
      assert.equal(Keys.End, 'End');
    });
  });

  describe('useId', () => {
    it('should generate unique IDs', () => {
      const getId1 = useId();
      const getId2 = useId();

      const id1 = getId1();
      const id2 = getId2();

      assert.notEqual(id1, id2);
      assert.ok(id1.startsWith('what-'));
      assert.ok(id2.startsWith('what-'));
    });

    it('should support custom prefix', () => {
      const getId = useId('custom');
      const id = getId();
      assert.ok(id.startsWith('custom-'));
    });
  });

  describe('useIds', () => {
    it('should generate multiple unique IDs', () => {
      const ids = useIds(3);

      assert.equal(ids.length, 3);
      assert.notEqual(ids[0], ids[1]);
      assert.notEqual(ids[1], ids[2]);
    });

    it('should support custom prefix', () => {
      const ids = useIds(2, 'form');

      assert.ok(ids[0].startsWith('form-'));
      assert.ok(ids[1].startsWith('form-'));
    });
  });

  describe('onKey', () => {
    it('should call handler when key matches', () => {
      let called = false;
      const handler = onKey('Enter', () => { called = true; });

      handler({ key: 'Enter' });
      assert.equal(called, true);
    });

    it('should not call handler when key does not match', () => {
      let called = false;
      const handler = onKey('Enter', () => { called = true; });

      handler({ key: 'Escape' });
      assert.equal(called, false);
    });
  });

  describe('onKeys', () => {
    it('should call handler when any key matches', () => {
      let called = false;
      const handler = onKeys(['Enter', ' '], () => { called = true; });

      handler({ key: ' ' });
      assert.equal(called, true);
    });

    it('should not call handler when no key matches', () => {
      let called = false;
      const handler = onKeys(['Enter', ' '], () => { called = true; });

      handler({ key: 'Tab' });
      assert.equal(called, false);
    });
  });
});
