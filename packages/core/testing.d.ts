// What Framework - Testing Utilities Type Definitions

import { VNode, Signal } from './index.js';

// Setup and Cleanup
export function setupDOM(): HTMLElement | null;
export function cleanup(): void;

// Render
export interface RenderResult {
  container: HTMLElement;
  unmount: () => void;
  getByText: (text: string | RegExp) => HTMLElement | null;
  getByTestId: (id: string) => HTMLElement | null;
  getByRole: (role: string) => HTMLElement | null;
  getAllByText: (text: string | RegExp) => HTMLElement[];
  queryByText: (text: string | RegExp) => HTMLElement | null;
  queryByTestId: (id: string) => HTMLElement | null;
  debug: () => void;
  findByText: (text: string | RegExp, timeout?: number) => Promise<HTMLElement>;
  findByTestId: (id: string, timeout?: number) => Promise<HTMLElement>;
}

export interface RenderOptions {
  container?: HTMLElement;
}

export function render(vnode: VNode, options?: RenderOptions): RenderResult;

// Fire Events
export interface FireEvent {
  click(element: HTMLElement): MouseEvent;
  change(element: HTMLInputElement, value: string): Event;
  input(element: HTMLInputElement, value: string): Event;
  submit(element: HTMLFormElement): Event;
  focus(element: HTMLElement): FocusEvent;
  blur(element: HTMLElement): FocusEvent;
  keyDown(element: HTMLElement, key: string, options?: KeyboardEventInit): KeyboardEvent;
  keyUp(element: HTMLElement, key: string, options?: KeyboardEventInit): KeyboardEvent;
  mouseEnter(element: HTMLElement): MouseEvent;
  mouseLeave(element: HTMLElement): MouseEvent;
}

export const fireEvent: FireEvent;

// Wait Utilities
export interface WaitOptions {
  timeout?: number;
  interval?: number;
}

export function waitFor<T>(callback: () => T, options?: WaitOptions): Promise<T>;
export function waitForElementToBeRemoved(callback: () => HTMLElement | null, options?: WaitOptions): Promise<void>;

// Act
export function act<T>(callback: () => T | Promise<T>): Promise<T>;

// Signal Testing Helpers
export interface TestSignal<T> {
  signal: Signal<T>;
  value: T;
  history: T[];
  reset(): void;
}

export function createTestSignal<T>(initial: T): TestSignal<T>;

// Mocking
export interface MockComponent {
  (props: Record<string, any>): VNode;
  displayName: string;
  calls: Array<{ props: Record<string, any>; timestamp: number }>;
  lastCall(): { props: Record<string, any>; timestamp: number } | undefined;
  reset(): void;
}

export function mockComponent(name?: string): MockComponent;

// Assertions
export interface Expect {
  toBeInTheDocument(element: HTMLElement | null): void;
  toHaveTextContent(element: HTMLElement | null, text: string | RegExp): void;
  toHaveAttribute(element: HTMLElement | null, attr: string, value?: string): void;
  toHaveClass(element: HTMLElement | null, className: string): void;
  toBeVisible(element: HTMLElement | null): void;
  toBeDisabled(element: HTMLElement | null): void;
  toHaveValue(element: HTMLInputElement | null, value: string): void;
}

export const expect: Expect;

// Screen
export interface Screen {
  getByText(text: string | RegExp): HTMLElement | null;
  getByTestId(id: string): HTMLElement | null;
  getByRole(role: string): HTMLElement | null;
  getAllByText(text: string | RegExp): HTMLElement[];
  queryByText(text: string | RegExp): HTMLElement | null;
  queryByTestId(id: string): HTMLElement | null;
  debug(): void;
}

export const screen: Screen;

// --- renderTest ---
// Render a component and expose the signals it created by debug name, so a test
// can drive state directly instead of going through the DOM.

export interface RenderTestResult {
  container: HTMLElement;
  /** Signals created during the component's single run, keyed by debug name. */
  signals: Record<string, Signal<any>>;
  /** Flush pending effects synchronously. */
  update(): void;
  unmount(): void;
}

export function renderTest<P = {}>(Component: (props: P) => any, props?: P): RenderTestResult;

/** Run every pending effect synchronously, so assertions see settled DOM. */
export function flushEffects(): void;

/**
 * Record which signals a callback reads and writes, by debug name.
 *
 * Reads are transitive: reading a computed reports the signals that computed
 * depends on, not the computed itself.
 *
 * `peek()` is not a read, and writing a value equal to the current one is not
 * a write, matching the reactive system's own semantics.
 *
 * A signal created without a debug name has no name to report and appears as
 * the single entry `'(unnamed)'`. Name your signals (`signal(0, 'count')`) to
 * get anything more specific.
 *
 * Dev builds only. In production the debug names and subscriber
 * back-references this reads are stripped, so it throws rather than reporting
 * an empty result that would look like "nothing happened".
 */
export function trackSignals(fn: () => void): { accessed: string[]; written: string[] };

// --- mockSignal ---
// A signal that records every distinct value it has held.

export interface MockSignal<T> extends Signal<T> {
  /** Every distinct value, oldest first, starting with the initial value. */
  readonly history: T[];
  /** How many times the value actually changed (equal writes do not count). */
  readonly setCount: number;
  /** Restore the initial value (or `value`) and clear the history. */
  reset(value?: T): void;
}

export function mockSignal<T>(name: string, initialValue: T): MockSignal<T>;
