// @thenjs/rpc — Tests for wire protocol

import { describe, it, expect } from 'vitest';
import { encode, decode } from '../src/wire.js';

describe('Wire Protocol', () => {
  describe('encode', () => {
    it('should pass through primitives', () => {
      expect(encode(null)).toBe(null);
      expect(encode(true)).toBe(true);
      expect(encode(42)).toBe(42);
      expect(encode('hello')).toBe('hello');
    });

    it('should tag Date objects', () => {
      const date = new Date('2024-01-15T12:00:00Z');
      const encoded = encode(date) as { __t: string; v: string };
      expect(encoded.__t).toBe('Date');
      expect(encoded.v).toBe('2024-01-15T12:00:00.000Z');
    });

    it('should tag BigInt values', () => {
      const encoded = encode(BigInt('9007199254740993')) as { __t: string; v: string };
      expect(encoded.__t).toBe('BigInt');
      expect(encoded.v).toBe('9007199254740993');
    });

    it('should tag undefined', () => {
      const encoded = encode(undefined) as { __t: string; v: string };
      expect(encoded.__t).toBe('Undefined');
    });

    it('should encode arrays recursively', () => {
      const result = encode([1, new Date('2024-01-01'), 'hello']);
      expect(result).toEqual([
        1,
        { __t: 'Date', v: '2024-01-01T00:00:00.000Z' },
        'hello',
      ]);
    });

    it('should encode objects recursively', () => {
      const result = encode({
        name: 'Alice',
        createdAt: new Date('2024-01-01'),
        age: 30,
      });
      expect(result).toEqual({
        name: 'Alice',
        createdAt: { __t: 'Date', v: '2024-01-01T00:00:00.000Z' },
        age: 30,
      });
    });

    it('should encode Set values', () => {
      const result = encode(new Set([1, 2, 3])) as { __t: string; v: string };
      expect(result.__t).toBe('Set');
    });

    it('should encode Map values', () => {
      const result = encode(new Map([['a', 1], ['b', 2]])) as { __t: string; v: string };
      expect(result.__t).toBe('Map');
    });
  });

  describe('decode', () => {
    it('should pass through primitives', () => {
      expect(decode(null)).toBe(null);
      expect(decode(true)).toBe(true);
      expect(decode(42)).toBe(42);
      expect(decode('hello')).toBe('hello');
    });

    it('should decode tagged Dates', () => {
      const result = decode({ __t: 'Date', v: '2024-01-15T12:00:00.000Z' });
      expect(result).toBeInstanceOf(Date);
      expect((result as Date).toISOString()).toBe('2024-01-15T12:00:00.000Z');
    });

    it('should decode tagged BigInts', () => {
      const result = decode({ __t: 'BigInt', v: '9007199254740993' });
      expect(result).toBe(BigInt('9007199254740993'));
    });

    it('should decode tagged undefined', () => {
      const result = decode({ __t: 'Undefined', v: '' });
      expect(result).toBeUndefined();
    });

    it('should decode arrays recursively', () => {
      const result = decode([
        1,
        { __t: 'Date', v: '2024-01-01T00:00:00.000Z' },
        'hello',
      ]);
      expect(Array.isArray(result)).toBe(true);
      expect((result as unknown[])[0]).toBe(1);
      expect((result as unknown[])[1]).toBeInstanceOf(Date);
      expect((result as unknown[])[2]).toBe('hello');
    });

    it('should decode objects recursively', () => {
      const result = decode({
        name: 'Alice',
        createdAt: { __t: 'Date', v: '2024-01-01T00:00:00.000Z' },
      }) as Record<string, unknown>;
      expect(result.name).toBe('Alice');
      expect(result.createdAt).toBeInstanceOf(Date);
    });
  });

  describe('roundtrip', () => {
    it('should roundtrip Dates', () => {
      const original = new Date('2024-06-15T10:30:00Z');
      const result = decode(encode(original)) as Date;
      expect(result.toISOString()).toBe(original.toISOString());
    });

    it('should roundtrip BigInts', () => {
      const original = BigInt('12345678901234567890');
      const result = decode(encode(original));
      expect(result).toBe(original);
    });

    it('should roundtrip complex objects', () => {
      const original = {
        user: {
          name: 'Alice',
          createdAt: new Date('2024-01-01'),
        },
        tags: ['admin', 'user'],
        count: 42,
      };
      const result = decode(encode(original)) as typeof original;
      expect(result.user.name).toBe('Alice');
      expect(result.user.createdAt).toBeInstanceOf(Date);
      expect(result.tags).toEqual(['admin', 'user']);
      expect(result.count).toBe(42);
    });
  });
});
