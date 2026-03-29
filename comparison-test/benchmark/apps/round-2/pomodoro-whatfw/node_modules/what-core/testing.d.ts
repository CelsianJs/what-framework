// What Framework - Testing Utilities Type Definitions

import { VNode, Signal } from './index';

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
