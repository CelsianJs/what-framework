// what-text — optional text engine for What Framework. TypeScript definitions.
//
// Declared by hand, like every other .d.ts here, and held to the runtime by
// `npm run hygiene:types`: every name below must be exported by src/index.js,
// and every name src/index.js exports must appear below.

// --- Configuration ---

export interface TextConfig {
  /**
   * Register the measurement hook with what-core's renderer. Off by default:
   * measuring every inserted text node costs layout reads, so it is opt-in.
   */
  measure: boolean;
  /** Maximum number of prepared-text entries held in the measure cache. */
  cacheSize: number;
}

/**
 * Merge `overrides` into the active config and register or unregister the
 * what-core text-insertion hook to match `measure`. Unknown keys are ignored
 * rather than stored, so a typo cannot silently become config.
 */
export function configureText(overrides: Partial<TextConfig>): void;

/** A copy of the active config. Mutating the result does not change it. */
export function getTextConfig(): TextConfig;

// --- Pretext ---
//
// @chenglou/pretext is an OPTIONAL peer dependency, so these describe the
// surface what-text actually calls rather than re-exporting pretext's own
// types. Importing them here would make the optional peer mandatory for
// TypeScript users, which is the opposite of optional.

/** Opaque prepared-text handle produced by `prepareWithSegments`. */
export type PreparedText = unknown;

export interface TextLine {
  text: string;
  /** Present when pretext segments the line; used to place the baseline. */
  start?: { segmentIndex: number };
  [key: string]: unknown;
}

export interface TextLayout {
  lines: TextLine[];
  lineCount: number;
  height: number;
  [key: string]: unknown;
}

export interface PretextModule {
  prepareWithSegments(text: string, font: string): PreparedText;
  layoutWithLines(prepared: PreparedText, containerWidth: number, lineHeight: number): TextLayout;
  [key: string]: unknown;
}

/**
 * Load @chenglou/pretext once and cache it. Rejects with an install hint when
 * the optional peer is absent; a failed load is not cached, so a later call
 * after installing it succeeds.
 */
export function ensurePretext(): Promise<PretextModule>;

// --- Measurement ---

/**
 * Lay `text` out at `font` inside `containerWidth`. Waits for document fonts
 * to settle first, because measuring against a fallback face and then against
 * the real one produces two different answers for the same input.
 */
export function measureText(
  text: string,
  font: string,
  containerWidth: number,
  lineHeight: number,
): Promise<TextLayout>;

/**
 * Drop every cached measurement. Called automatically when the document
 * finishes loading fonts, since every prior measurement used a fallback face.
 */
export function clearMeasureCache(): void;

// --- Components ---
//
// These build and return DOM nodes directly rather than returning a What
// element, so they are usable both as JSX components and as plain calls.

/** A value, or a getter that What re-reads when its signals change. */
export type Reactive<T> = T | (() => T);

export interface TextFlowProps {
  /** CSS column count. Defaults to 1. */
  columns?: number;
  /** Element the text should flow around. */
  around?: Element | null;
  /** CSS column-gap. Defaults to '1rem'. */
  gap?: string;
  children?: Reactive<unknown>;
}

/** Multi-column flowing text. Returns the container `<div>`. */
export function TextFlow(props: TextFlowProps): HTMLDivElement;

export interface TextCanvasProps {
  /** Canvas width in px. Defaults to 300. */
  width?: number;
  /** Canvas height in px. Defaults to 150. */
  height?: number;
  /** CSS font shorthand. Defaults to '16px sans-serif'. */
  font?: string;
  children?: Reactive<unknown>;
}

/** Text rendered to a `<canvas>` via pretext layout. Returns the canvas. */
export function TextCanvas(props: TextCanvasProps): HTMLCanvasElement;

export interface TextSVGProps {
  /** SVG width in px. Defaults to 300. */
  width?: number;
  /** SVG height in px. Defaults to 150. */
  height?: number;
  /** CSS font shorthand. Defaults to '16px sans-serif'. */
  font?: string;
  children?: Reactive<unknown>;
}

/** Text rendered as `<text>`/`<tspan>` elements. Returns the `<svg>`. */
export function TextSVG(props: TextSVGProps): SVGSVGElement;
