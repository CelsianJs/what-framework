// what-core/motion (what-framework/motion): springs, tweens, gestures and CSS transitions.
import type { Signal } from './index.js';

// --- Animation ---
//
// Every accessor below is a plain getter function, NOT a Signal: the objects
// these factories return expose reads through closures and offer writes as
// named methods (set/snap/setValue), so nothing here carries .set/.peek.
// spring() and tween() return two different objects, SpringValue and
// TweenValue.

export interface SpringConfig {
  stiffness?: number;
  damping?: number;
  mass?: number;
  precision?: number;
}

/** Physics-based value. `set()` retargets and animates; `snap()` jumps without animating. */
export interface SpringValue {
  current(): number;
  target(): number;
  velocity(): number;
  isAnimating(): boolean;
  set(target: number): void;
  stop(): void;
  snap(value: number): void;
  subscribe(fn: (value: number) => void): () => void;
}

export interface TweenConfig {
  duration?: number;
  easing?: (t: number) => number;
  onUpdate?: (value: number, progress: number) => void;
  onComplete?: () => void;
}

/**
 * Easing-based interpolation from `from` to `to`. Starts immediately on
 * creation and runs to completion, so it exposes `cancel()` rather than the
 * spring's retargeting `set()`/`stop()`.
 */
export interface TweenValue {
  progress(): number;
  value(): number;
  isAnimating(): boolean;
  cancel(): void;
  subscribe(fn: (value: number) => void): () => void;
}

export function spring(initialValue: number, config?: SpringConfig): SpringValue;
/**
 * Both endpoints are required and positional. This was declared as
 * `tween(initialValue?, config?)` returning a SpringValue, so the documented
 * call `tween(0, 100, { duration: 300 })` was a type error, while
 * `tween(0).current()` type-checked and threw (`current` does not exist, and a
 * missing `to` interpolates toward undefined).
 */
export function tween(from: number, to: number, config?: TweenConfig): TweenValue;
export const easings: Record<string, (t: number) => number>;
/**
 * Drives a 0..1 progress value over `duration`. Named useTween so that
 * useTransition can mean what it means in React.
 */
export function useTween(options?: { duration?: number; easing?: (t: number) => number }): {
  isTransitioning: () => boolean;
  progress: () => number;
  start: (callback?: () => void) => Promise<void>;
};

/** Live gesture state. `startX`/`startY` are plain numbers rewritten in place at gesture start. */
export interface GestureState {
  isDragging: Signal<boolean>;
  startX: number;
  startY: number;
  currentX: Signal<number>;
  currentY: Signal<number>;
  deltaX: Signal<number>;
  deltaY: Signal<number>;
  velocity: Signal<GestureVelocity>;
}

export interface GestureVelocity {
  x: number;
  y: number;
}

/**
 * `preventDefault` is why this cannot be a `Record<string, (payload) => void>`:
 * it sits in the same object as the callbacks and is a boolean.
 */
export interface GestureHandlers {
  onDragStart?: (payload: { x: number; y: number }) => void;
  onDrag?: (payload: {
    x: number; y: number; deltaX: number; deltaY: number; velocity: GestureVelocity;
  }) => void;
  onDragEnd?: (payload: { deltaX: number; deltaY: number; velocity: GestureVelocity }) => void;
  onPinch?: (payload: { scale: number; centerX: number; centerY: number }) => void;
  onSwipe?: (payload: { direction: 'up' | 'down' | 'left' | 'right'; velocity: GestureVelocity }) => void;
  onTap?: (payload: { x: number; y: number }) => void;
  onLongPress?: (payload: { x: number; y: number }) => void;
  /** Opt in to e.preventDefault() in the touch handlers (listeners become non-passive). */
  preventDefault?: boolean;
}

/** Returns the gesture state. It was declared `void`, so the state was unreachable from TypeScript. */
export function useGesture(
  ref: { current?: Element | null } | Element | (() => Element | null),
  handlers?: GestureHandlers,
): GestureState;

/** Handle for one running animation started by useAnimatedValue. */
export interface AnimationHandle {
  stop: () => void;
}

/**
 * `animateTo` and `stop` were declared here and have never existed. Animations
 * are started with spring()/timing(), each returning its own handle to stop.
 */
export function useAnimatedValue(initialValue: number): {
  value: () => number;
  setValue: (value: number) => void;
  spring: (toValue: number, config?: SpringConfig) => AnimationHandle;
  timing: (toValue: number, config?: TweenConfig) => AnimationHandle;
  interpolate: (inputRange: number[], outputRange: number[]) => () => number;
  subscribe: (fn: (value: number) => void) => () => void;
};

export interface TransitionClasses {
  enter: string;
  enterActive: string;
  enterDone: string;
  exit: string;
  exitActive: string;
  exitDone: string;
}

/** Returns the six class NAMES for `name`, not a single string. */
export function createTransitionClasses(name: string): TransitionClasses;
/**
 * Applies the enter/exit class sequence to an element and resolves when the
 * transition is done. It was declared as a synchronous `(config) => object`.
 */
export function cssTransition(
  element: Element,
  name: string,
  type?: 'enter' | 'exit',
  duration?: number,
): Promise<void>;

/** Enter/leave classes for a CSS transition, as props to spread on the element. */
export function transitionClass(name: string, active: boolean): { class: string };
