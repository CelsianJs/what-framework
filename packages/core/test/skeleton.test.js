// Tests for What Framework - Skeleton Loaders
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// We can test the component structure without DOM
// by checking the returned vnode

const { Skeleton, SkeletonText, SkeletonAvatar, SkeletonCard, SkeletonTable, IslandSkeleton, Placeholder, LoadingDots, Spinner } = await import('../src/skeleton.js');

describe('skeleton loaders', () => {
  describe('Skeleton', () => {
    it('should create a skeleton vnode', () => {
      const vnode = Skeleton({ width: 100, height: 20 });

      assert.ok(vnode);
      assert.equal(vnode.tag, 'div');
      assert.ok(vnode.props.class.includes('what-skeleton'));
    });

    it('should support circle variant', () => {
      const vnode = Skeleton({ width: 50, height: 50, circle: true });

      assert.equal(vnode.props.style.borderRadius, '50%');
    });

    it('should support pulse variant', () => {
      const vnode = Skeleton({ variant: 'pulse' });

      assert.ok(vnode.props.class.includes('what-skeleton-pulse'));
    });

    it('should support wave variant', () => {
      const vnode = Skeleton({ variant: 'wave' });

      assert.ok(vnode.props.class.includes('what-skeleton-wave'));
    });

    it('should support count for multiple skeletons', () => {
      const vnodes = Skeleton({ count: 3 });

      assert.ok(Array.isArray(vnodes));
      assert.equal(vnodes.length, 3);
    });

    it('should have aria-hidden for accessibility', () => {
      const vnode = Skeleton({});

      assert.equal(vnode.props['aria-hidden'], 'true');
    });
  });

  describe('SkeletonText', () => {
    it('should create multiple text line skeletons', () => {
      const vnode = SkeletonText({ lines: 4 });

      assert.ok(vnode);
      assert.equal(vnode.tag, 'div');
      assert.equal(vnode.children.length, 4);
    });

    it('should make last line shorter by default', () => {
      const vnode = SkeletonText({ lines: 3 });

      const lastChild = vnode.children[vnode.children.length - 1];
      assert.equal(lastChild.props.style.width, '60%');
    });
  });

  describe('SkeletonAvatar', () => {
    it('should create circular skeleton', () => {
      const vnode = SkeletonAvatar({ size: 40 });

      assert.equal(vnode.props.style.width, '40px');
      assert.equal(vnode.props.style.height, '40px');
      assert.equal(vnode.props.style.borderRadius, '50%');
    });
  });

  describe('SkeletonCard', () => {
    it('should create card skeleton with image and text', () => {
      const vnode = SkeletonCard({});

      assert.ok(vnode);
      assert.ok(vnode.children.length >= 2); // Image, title, and text
    });
  });

  describe('SkeletonTable', () => {
    it('should create table skeleton with header and rows', () => {
      const vnode = SkeletonTable({ rows: 5, columns: 4 });

      assert.ok(vnode);
      // First child is header, rest are rows
      assert.ok(vnode.children.length > 1);
    });
  });

  describe('IslandSkeleton', () => {
    it('should return card skeleton for type card', () => {
      const vnode = IslandSkeleton({ type: 'card' });

      assert.ok(vnode);
      assert.ok(vnode.props.class.includes('what-skeleton-card'));
    });

    it('should return text skeleton for type text', () => {
      const vnode = IslandSkeleton({ type: 'text' });

      assert.ok(vnode);
      assert.ok(vnode.props.class.includes('what-skeleton-text'));
    });

    it('should return default skeleton', () => {
      const vnode = IslandSkeleton({});

      assert.ok(vnode);
      assert.ok(vnode.props.class.includes('what-skeleton'));
    });
  });

  describe('Placeholder', () => {
    it('should create placeholder with loading label', () => {
      const vnode = Placeholder({ label: 'Loading content...' });

      assert.equal(vnode.props['aria-label'], 'Loading content...');
      assert.equal(vnode.props.role, 'status');
    });
  });

  describe('LoadingDots', () => {
    it('should create three animated dots', () => {
      const vnode = LoadingDots({});

      assert.equal(vnode.children.length, 3);
      assert.equal(vnode.props.role, 'status');
    });
  });

  describe('Spinner', () => {
    it('should create SVG spinner', () => {
      const vnode = Spinner({ size: 24 });

      assert.equal(vnode.tag, 'svg');
      assert.equal(vnode.props.width, 24);
      assert.equal(vnode.props.height, 24);
      assert.equal(vnode.props.role, 'status');
    });
  });
});
