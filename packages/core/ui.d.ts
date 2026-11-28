// what-core/ui (what-framework/ui): skeletons and loading placeholders.
import type { VNode } from './index.js';

// --- Skeleton ---

export function Skeleton(props?: Record<string, any>): VNode;
export function SkeletonText(props?: Record<string, any>): VNode;
export function SkeletonAvatar(props?: Record<string, any>): VNode;
export function SkeletonCard(props?: Record<string, any>): VNode;
export function SkeletonTable(props?: Record<string, any>): VNode;
export function IslandSkeleton(props?: Record<string, any>): VNode;
export function useSkeleton<T>(asyncFn: () => Promise<T> | T, deps?: unknown[]): {
  isLoading: () => boolean;
  data: () => T | null;
  error: () => any;
  Skeleton: (props?: Record<string, any>) => VNode;
};
export function Placeholder(props?: Record<string, any>): VNode;
export function LoadingDots(props?: Record<string, any>): VNode;
export function Spinner(props?: Record<string, any>): VNode;
