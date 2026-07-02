import {
  createServer,
  type ServerOptions,
  type Session,
  type Stream,
} from "@stateforward/yamux.ts";
import {
  ProxyableHandler,
  ProxyInstructionKinds,
  ProxyInstructionDecoder,
  ProxyInstructionEncoder,
  ProxyExecuteInstruction,
  ProxyInstruction,
  ProxyInstructionUnknown,
  ProxyGetInstruction,
  ProxyError,
  UnproxyableValue,
  ProxyValueKinds,
  InferProxyValueKind,
  ProxyExecuteResult,
  ProxyableExport,
  ProxyableNamespace,
  ProxyReferenceInstruction,
  ProxyInstructions,
} from "./types";
import { encode, decode } from "@msgpack/msgpack";
import { createDecoder } from "./decoder";
import { logger } from "./logger";
import {
  createInstructionUnsafe,
  createThrowInstruction,
  createReturnInstruction,
} from "./instructions";
import { make as muid } from "./muid";
import { createEncoder } from "./encoder";
import { ProxyableSymbol } from "./symbol";
import { ObjectRegistry } from "./registry";
import { StreamPool } from "./stream_pool";
import {
  concatBytes,
  readEachStreamChunk,
  readInstructionFromStream,
  tryDecodeInstruction,
  writeToStream,
} from "./transport";
export { ObjectRegistry };

const log = logger.child({
  module: "proxyable.exported",
});

export function createHandlerError(message: string): ProxyError {
  return {
    message,
  };
}

const PRIMITIVE_TYPES = [
  "boolean",
  "number",
  "string",
  "symbol",
  "bigint",
  "undefined",
];

function isPrimitive(value: unknown): boolean {
  return value === null || PRIMITIVE_TYPES.includes(typeof value);
}

function createProxyableServer<TObject extends object>(
  handler: ProxyableHandler<TObject>,
  transport: ServerOptions
): Session {
  const server = createServer(transport);

  const handleStream = async (stream: Stream) => {
    let requestBuffer = new Uint8Array();
    await readEachStreamChunk(stream, async (data) => {
      requestBuffer = concatBytes(requestBuffer, data);
      const instruction = tryDecodeInstruction(handler.decode, requestBuffer, [
        ProxyInstructionKinds.execute,
        ProxyInstructionKinds.release,
      ]);
      if (!instruction) {
        return;
      }
      requestBuffer = new Uint8Array();
      let evalError, evalResult;
      try {
        [evalError, evalResult] = await handler.eval(instruction, []);
      } catch (e: any) {
        log.error({ error: e }, "handler logic threw error");
        evalError = createHandlerError(e.message || "Unknown error");
      }
      log.info({ evalError, evalResult }, `execution result`);
      if (evalError) {
        log.error({ error: evalError }, `execution error`);
      }
      const bytes = encode(
        evalError ? createThrowInstruction(evalError) : evalResult
      );
      log.info({ results: evalResult }, `sending results`);
      await writeToStream(stream, bytes);
    });
  };

  void (async () => {
    for (;;) {
      try {
        void handleStream(await server.acceptStream()).catch((error) => {
          log.error({ error }, "yamux stream handler failed");
        });
      } catch (error) {
        log.debug({ error }, "stopped accepting yamux streams");
        return;
      }
    }
  })();

  return server;
}

type KeyOrValue<TValue = unknown> =
  | { key: string; value?: never }
  | { value: TValue; key?: never };


export function createExportedProxyable<TObject extends object>(parameters: {
  transport: ServerOptions;
  object: TObject;
  handler?: ProxyableHandler<TObject>;
  decoder?: ProxyInstructionDecoder;
  encoder?: ProxyInstructionEncoder;
  registry?: ObjectRegistry;
  streamPoolSize?: number;
  streamPoolReuse?: boolean;
}): ProxyableExport<TObject> {
  const object = parameters.object;
  const registry = parameters.registry ?? new ObjectRegistry();
  let streamPool: StreamPool | null = null;
  let server: Session;

  const createValue = <TValue, TKind extends number | ProxyValueKinds>(
    value: TValue,
    kind?: InferProxyValueKind<TValue> | number
  ): UnproxyableValue<TValue, TKind> => {
    if (typeof kind !== "number") {
      kind = ProxyValueKinds[typeof value] as any; // Cast needed because of dynamic type
    }
     // Safe check for missing kinds
     if (!kind && value !== null && typeof value === "object") {
         kind = ProxyValueKinds.object;
         kind = ProxyValueKinds.object;
     }

     log.info({ value, kind, type: typeof value }, `creating unproxyable value`);
    
    if (isPrimitive(value)) {
      if (kind === undefined) kind = ProxyValueKinds[typeof value as any] as any;
      return {
        id: muid().toString(),
        kind: kind as TKind,
        data: value,
      } as UnproxyableValue<TValue, TKind>;
    }

    if (typeof value === "function" || (typeof value === "object" && value !== null)) {
        // Register object/function and return reference
        const refId = registry.register(value);
        return {
            id: muid().toString(),
            kind: ProxyValueKinds.Reference,
            data: refId,
        } as unknown as UnproxyableValue<TValue, TKind>;
    }
    
    // Fallback? Should be unreachable given above logic
    return {
      id: muid().toString(),
      kind: kind as TKind,
      data: value,
    } as UnproxyableValue<TValue, TKind>;
  };

  const { decode } = parameters.decoder ?? createDecoder();
  const { encode } = parameters.encoder ?? createEncoder();
  const id = muid().toString();
  
  const boundMethodCache = new WeakMap<object, Map<string | symbol, Function>>();

  const getStreamPool = () => {
    if (!streamPool) {
      streamPool = new StreamPool({
        session: server,
        max: parameters.streamPoolSize ?? 8,
        reuse: parameters.streamPoolReuse ?? true,
      });
    }
    return streamPool;
  };

  const decodeResponseValue = (
    response: ProxyInstruction | null
  ): unknown => {
    if (!response) {
      throw new Error("incomplete callback response");
    }
    if (response.kind === ProxyInstructionKinds.throw) {
      const error = response.data as any;
      throw new Error(error?.message ?? String(error));
    }
    const wrapped = (response as any).data;
    if (!wrapped || typeof wrapped !== "object" || !("kind" in wrapped)) {
      return wrapped;
    }
    if (wrapped.kind === ProxyValueKinds.undefined) {
      return undefined;
    }
    if (wrapped.kind === ProxyValueKinds.null) {
      return null;
    }
    return "data" in wrapped ? wrapped.data : wrapped;
  };

  const executeRemoteReferenceInstructions = async (
    instructions: ProxyInstructions[]
  ) => {
    const substream = await getStreamPool().acquire();
    try {
      const execInstruction = createInstructionUnsafe(
        ProxyInstructionKinds.execute,
        instructions
      );
      await writeToStream(substream, encode(execInstruction));
      const response = await readInstructionFromStream(substream, decode, [
        ProxyInstructionKinds.return,
        ProxyInstructionKinds.throw,
      ]);
      return decodeResponseValue(response);
    } finally {
      getStreamPool().release(substream);
    }
  };

  const createRemoteReferenceProxy = (refId: string) =>
    new Proxy(function () {}, {
      get: (_, key: PropertyKey) => {
        if (key === "then") {
          return undefined;
        }
        return (...callArgs: unknown[]) =>
          executeRemoteReferenceInstructions([
                { kind: ProxyValueKinds.Reference, data: refId, id: muid().toString() },
                createInstructionUnsafe(ProxyInstructionKinds.get, [String(key)]),
                createInstructionUnsafe(
                  ProxyInstructionKinds.apply,
                  callArgs.map((value) => createValue(value))
                ),
          ]);
      },
      apply: (_, __, callArgs) =>
        executeRemoteReferenceInstructions([
              { kind: ProxyValueKinds.Reference, data: refId, id: muid().toString() },
              createInstructionUnsafe(
                ProxyInstructionKinds.apply,
                callArgs.map((value) => createValue(value))
              ),
        ]),
    });
  const handler: ProxyableHandler<TObject> =
    parameters.handler ??
    ({
      get session() {
        return server;
      },
      decode,
      encode,
      [ProxyInstructionKinds.execute]: async (
        data: ProxyExecuteInstruction["data"],
        stack: unknown[] = []
      ): Promise<ProxyExecuteResult> => {
        log.info({ data }, `executing instructions`);
        
        // Execute Instructions.
        for (const instruction of data) {
           if (instruction.kind === ProxyValueKinds.Reference) {
               const registered = registry.get(instruction.data as string);
               if (!registered) {
                 return [createHandlerError(`missing reference: ${String(instruction.data)}`)];
               }
               stack.push(registered);
               continue;
           }

           const operation =
             handler?.[instruction.kind as ProxyInstructionKinds];
          if (!operation) {
            continue;
          }
           
           let currentTarget: any = object; // Default root
           if (stack.length > 0) {
              currentTarget = stack.pop();
           }
           
          const [error, result] = await operation(instruction.data as any, stack as any, currentTarget);
          if (error) {
            return [error];
          }
          stack.push(result);
        }
        
        if (stack.length === 0) {
          return [createHandlerError("no result")];
        }
        const result = stack.pop();
        return [null, createReturnInstruction(createValue(result) as any)];
      },
      [ProxyInstructionKinds.get]: async (
        data: ProxyGetInstruction["data"],
        stack: ProxyInstruction[] = [],
        target: any = object
      ) => {
        log.info({ data }, `getting value`);
        const [key] = data;
        let val = target[key];
        // Auto-bind functions to preserve context (e.g. class methods)
        if (typeof val === "function") {
            try {
                // Check cache to ensure we return stable reference for deduplication
                let cache = boundMethodCache.get(target);
                if (!cache) {
                    cache = new Map();
                    boundMethodCache.set(target, cache);
                }
                const cached = cache.get(key);
                if (cached) {
                    val = cached;
                } else {
                    // Determine if it's a class or just a method?
                    // Binding a class constructor might be weird but strictly valid.
                    // However, for methods (like greet), we MUST bind to target (instance).
                    // Note: This creates a new function identity, breaking === equality for methods.
                    // This is an acceptable tradeoff for correct RPC method behavior.
                    val = val.bind(target);
                    cache.set(key, val);
                }
            } catch (e) {
                // Ignore binding errors (e.g. if not bindable)
            }
        }
        return [null, val];
      },
      [ProxyInstructionKinds.apply]: async (
        data: any, // [string, args] ??
        stack: ProxyInstruction[] = [],
        target: any = object
      ) => {
         // Hydrate arguments (Callbacks)
         const args = (data as unknown[]).map(arg => {
             if (arg && typeof arg === 'object' && (arg as any).kind === ProxyValueKinds.Reference) {
                 return createRemoteReferenceProxy((arg as any).data);
             }
             if (arg && typeof arg === "object" && "data" in (arg as any)) {
                 return (arg as any).data;
             }
             return arg;
         });

         if (typeof target === 'function') {
             const result = await Reflect.apply(target, object, args); 
             return [null, result];
         }
         return [createHandlerError("target is not a function")];
      },
       [ProxyInstructionKinds.construct]: async (
        data: unknown[],
        stack: ProxyInstruction[] = [],
        target: any = object
      ) => {
         // Hydrate arguments (Callbacks)
         const args = (data as unknown[]).map(arg => {
             if (arg && typeof arg === 'object' && (arg as any).kind === ProxyValueKinds.Reference) {
                 return createRemoteReferenceProxy((arg as any).data);
             }
             if (arg && typeof arg === "object" && "data" in (arg as any)) {
                 return (arg as any).data;
             }
             return arg;
         });

         if (typeof target === 'function') { // constructor
             const result = Reflect.construct(target, args);
             return [null, result];
         }
         return [createHandlerError("target is not a constructor")];
      },
      [ProxyInstructionKinds.release]: async (
        data: [string], // refId
        stack: ProxyInstruction[] = []
      ) => {
          const [refId] = data;
          log.info({ refId }, "releasing object reference");
          registry.delete(refId);
          return [null, undefined];
      },
      
      eval: async (
        instruction: ProxyInstructionUnknown,
        stack: ProxyInstruction[] = []
      ): Promise<ProxyExecuteResult> => {
        // Eval logic needs to be robust. 
        // Allow metadata.target override for initial context.
        let target = object;
        if (instruction.metadata && (instruction.metadata as any).target) {
            const t = registry.get((instruction.metadata as any).target);
            if (t) target = t as any;
        }
        
        const operation = handler?.[instruction.kind as ProxyInstructionKinds];
        if (!operation) {
          return [
            createHandlerError(`unknown instruction kind ${instruction.kind}`),
          ];
        }
        const [error, result] = await operation(instruction.data as any, stack, target);
        if (error) {
          log.error({ error }, `eval error`);
          return [error];
        }
        log.info({ result }, `eval result`);
        return [null, result as any];
      },
      get(target: TObject, key: string | symbol) {
        if (key === ProxyableSymbol.handler) {
          return handler;
        }
        if (key === ProxyableSymbol.id) {
          return id;
        }
        return [null, createValue(object[key as keyof typeof object])];
      },
    } satisfies ProxyableHandler<TObject>);
  server = createProxyableServer(handler, parameters.transport);

  return new Proxy(object, handler) as ProxyableExport<TObject>;
}
