// @thenjs/rpc — Thin re-export layer over @celsian/rpc
// All RPC functionality comes from CelsianJS.

export {
  procedure,
  createProcedure,
  router,
  RPCHandler,
  createRPCClient,
  RPCError,
  encode,
  decode,
  generateOpenAPI,
} from '@celsian/rpc';

export type {
  RPCContext,
  ContextFactory,
  ProcedureType,
  ProcedureDefinition,
  MiddlewareFunction,
  RouterDefinition,
  RPCManifest,
  RPCRequest,
  RPCResponse,
  TaggedValue,
  OpenAPISpec,
  RPCClientOptions,
} from '@celsian/rpc';
