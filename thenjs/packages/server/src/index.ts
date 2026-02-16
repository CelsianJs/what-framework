// @thenjs/server — Thin re-export layer over @celsian/server
// ThenJS uses CelsianJS as its backend runtime. This package provides
// Then-branded aliases and the ThenJS-specific configuration system.

// Re-export CelsianJS server with Then-branded aliases
export {
  CelsianApp as ThenApp,
  createApp,
  createReply,
  Router,
  fp,
  kSkipOverride,
} from '@celsian/server';

// Middleware
export {
  cors, rateLimit, jwtAuth, logger, etag, withETag, MemoryStore,
} from '@celsian/server';

export type {
  CorsOptions, RateLimitOptions, RateLimitStore,
  JwtAuthOptions, JwtPayload,
  LoggerOptions, LogEntry,
  ETagOptions,
} from '@celsian/server';

// SSE
export { createSSEStream, createSSEHub } from '@celsian/server';
export type { SSEEvent, SSEStreamOptions, SSEChannel, SSEHub } from '@celsian/server';

// WebSocket
export { WSRegistry, createRoom, wrapWebSocket, parseWSMessage, websocket } from '@celsian/server';
export type { WSHandler, WSSocket, WSMessage, WSRoute, WSRoom } from '@celsian/server';

// Tasks & Cron
export { createTaskQueue, createCronScheduler } from '@celsian/server';
export type {
  TaskQueue, TaskJob, TaskPayload, TaskResult,
  TaskHandler, TaskDefinition, QueueStats,
  CronJob, CronScheduler,
} from '@celsian/server';

// Type aliases — ThenJS naming conventions
export type {
  CelsianAppOptions as ThenAppOptions,
  CelsianRequest as ThenRequest,
  CelsianReply as ThenReply,
  HookName,
  HookHandler,
  OnErrorHandler,
  RouteMethod,
  RouteHandler,
  RouteOptions,
  RouteMatch,
  InternalRoute,
  PluginFunction,
  PluginOptions,
  PluginContext,
} from '@celsian/server';

// ThenJS-specific configuration (not in CelsianJS)
export { defineConfig, loadConfig } from './config.js';
export type { ThenConfig } from './config.js';
