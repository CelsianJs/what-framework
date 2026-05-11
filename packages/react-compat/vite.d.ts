export type Plugin = any;

export interface ReactCompatOptions {
  exclude?: string[];
  autoDetect?: boolean;
}

export function reactCompat(options?: ReactCompatOptions): Plugin;
