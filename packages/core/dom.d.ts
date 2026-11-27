// what-core/dom (what-framework/dom): the DOM read/write scheduler and DOM utilities.
import type { Signal } from './index.js';

// --- Scheduler ---
// Batch reads before writes so a frame never thrashes layout.

export function scheduleRead(fn: () => void): () => void;
export function scheduleWrite(fn: () => void): () => void;
export function flushScheduler(): void;
export function measure<T>(fn: () => T): Promise<T>;
export function mutate(fn: () => void): Promise<void>;
export function useScheduledEffect(readFn: () => any, writeFn?: (data: any) => void): () => void;
export function nextFrame(): Promise<void> & { cancel: () => void };
export function raf(key: string, fn: () => void): void;
export function onResize(element: Element, callback: (rect: DOMRectReadOnly) => void): () => void;
export function onIntersect(
  element: Element,
  callback: (entry: IntersectionObserverEntry) => void,
  options?: IntersectionObserverInit,
): () => void;
export function smoothScrollTo(
  element: Element,
  options?: { duration?: number; easing?: (t: number) => number },
): Promise<void>;

// --- Utilities ---

export type ClassValue = string | false | null | undefined | Record<string, unknown> | ClassValue[];
export function cls(...args: ClassValue[]): string;
export function style(obj: string | Record<string, string | number | null | undefined>): string;
/** Calls `fn` once, with the last call's arguments, `ms` after the calls stop. */
export function debounce<T extends (...args: any[]) => any>(fn: T, ms: number): (...args: Parameters<T>) => void;
/** Calls `fn` at once, then at most once per `ms`; a call inside the window is dropped. */
export function throttle<T extends (...args: any[]) => any>(fn: T, ms: number): (...args: Parameters<T>) => void;
export function useMediaQuery(query: string): Signal<boolean>;
export function useLocalStorage<T>(key: string, initial: T): Signal<T>;
export function useClickOutside(ref: { current?: Element | null } | Element, handler: (e: Event) => void): void;
/** Remove the head tags <Head> manages. */
export function clearHead(): void;
