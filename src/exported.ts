import { Client, Duplex, Server, Session } from "yamux-js/cjs";
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

function tryDecodeInstruction(
  decoder: ProxyInstructionDecoder["decode"],
  data: Buffer,
  kinds: number[]
): ProxyInstruction | null {
  try {
    const [error, instruction] = decoder(data, kinds as any);
    if (error) {
      return null;
    }
    return instruction as ProxyInstruction;
  } catch {
    return null;
  }
}

function createProxyableServer<TObject extends object>(
  handler: ProxyableHandler<TObject>
) {
  return new Server((stream) => {
    let requestBuffer = Buffer.alloc(0);
    stream.on("data", async (data: Uint8Array) => {
      requestBuffer = Buffer.concat([requestBuffer, Buffer.from(data)]);
      const instruction = tryDecodeInstruction(handler.decode, requestBuffer, [
        ProxyInstructionKinds.execute,
        ProxyInstructionKinds.release,
      ]);
      if (!instruction) {
        return;
      }
      requestBuffer = Buffer.alloc(0);
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
      stream.write(Buffer.from(bytes));
    });
  });
}

type KeyOrValue<TValue = unknown> =
  | { key: string; value?: never }
  | { value: TValue; key?: never };


export function createExportedProxyable<TObject extends object>(parameters: {
  stream?: Duplex;
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
        session: server as any,
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

  const createRemoteReferenceProxy = (refId: string) =>
    new Proxy(function () {}, {
      get: (_, key: PropertyKey) => {
        if (key === "then") {
          return undefined;
        }
        return (...callArgs: unknown[]) =>
          new Promise((resolve, reject) => {
            const run = async () => {
              const substream = await getStreamPool().acquire();
              let responseBuffer = Buffer.alloc(0);
              const cleanup = () => {
                substream.removeAllListeners("data");
                substream.removeAllListeners("error");
                getStreamPool().release(substream);
              };
              substream.on("data", (chunk) => {
                responseBuffer = Buffer.concat([responseBuffer, Buffer.from(chunk)]);
                const response = tryDecodeInstruction(decode, responseBuffer, [
                  ProxyInstructionKinds.return,
                  ProxyInstructionKinds.throw,
                ]);
                if (!response) {
                  return;
                }
                cleanup();
                try {
                  resolve(decodeResponseValue(response));
                } catch (error) {
                  reject(error);
                }
              });
              substream.on("error", (error) => {
                cleanup();
                reject(error);
              });
              const finalInstructions: ProxyInstructions[] = [
                { kind: ProxyValueKinds.Reference, data: refId, id: muid().toString() },
                createInstructionUnsafe(ProxyInstructionKinds.get, [String(key)]),
                createInstructionUnsafe(
                  ProxyInstructionKinds.apply,
                  callArgs.map((value) => createValue(value))
                ),
              ];
              const execInstruction = createInstructionUnsafe(
                ProxyInstructionKinds.execute,
                finalInstructions
              );
              substream.write(Buffer.from(encode(execInstruction)));
            };
            void run().catch(reject);
          });
      },
      apply: (_, __, callArgs) =>
        new Promise((resolve, reject) => {
          const run = async () => {
            const substream = await getStreamPool().acquire();
            let responseBuffer = Buffer.alloc(0);
            const cleanup = () => {
              substream.removeAllListeners("data");
              substream.removeAllListeners("error");
              getStreamPool().release(substream);
            };
            substream.on("data", (chunk) => {
              responseBuffer = Buffer.concat([responseBuffer, Buffer.from(chunk)]);
              const response = tryDecodeInstruction(decode, responseBuffer, [
                ProxyInstructionKinds.return,
                ProxyInstructionKinds.throw,
              ]);
              if (!response) {
                return;
              }
              cleanup();
              try {
                resolve(decodeResponseValue(response));
              } catch (error) {
                reject(error);
              }
            });
            substream.on("error", (error) => {
              cleanup();
              reject(error);
            });
            const finalInstructions: ProxyInstructions[] = [
              { kind: ProxyValueKinds.Reference, data: refId, id: muid().toString() },
              createInstructionUnsafe(
                ProxyInstructionKinds.apply,
                callArgs.map((value) => createValue(value))
              ),
            ];
            const execInstruction = createInstructionUnsafe(
              ProxyInstructionKinds.execute,
              finalInstructions
            );
            substream.write(Buffer.from(encode(execInstruction)));
          };
          void run().catch(reject);
        }),
    });

  const handler: ProxyableHandler<TObject> =
    parameters.handler ??
    ({
      get stream() {
        return server;
      },
      decode,
      encode,
      [ProxyInstructionKinds.execute]: async (
        data: ProxyExecuteInstruction["data"],
        stack: ProxyInstruction[] = []
      ): Promise<ProxyExecuteResult> => {
        log.info({ data }, `executing instructions`);
        
        // Execute Instructions.
        for (const instruction of data) {
           if (instruction.kind === ProxyValueKinds.Reference) {
               stack.push(instruction);
               continue;
           }

           const operation =
             handler?.[instruction.kind as ProxyInstructionKinds];
          if (!operation) {
            continue;
          }
           
           // Resolve target from stack?
           // If stack is not empty, use top as target IF it is a Reference.
           let currentTarget: any = object; // Default root
           if (stack.length > 0) {
              const previous = stack[stack.length - 1]; // Peek
              if (previous.kind === ProxyValueKinds.Reference) {
                  const refId = previous.data as string;
                  const registered = registry.get(refId);
                  if (registered) {
                      currentTarget = registered;
                      // Should we Pop the target? 
                      // If `get` consumes the target, yes.
                      // Instructions like `get` usually operate on a subject.
                      // Let's assume `get` consumes the subject from stack.
                      stack.pop(); 
                  }
              }
           }
           
          const [error, result] = await operation(instruction.data as any, stack, currentTarget);
          if (error) {
            return [error];
          }
          stack.push(result as ProxyInstruction);
        }
        
        const result = stack.shift();
        if (!result) {
          return [createHandlerError("no result")];
        }
        return [null, createReturnInstruction(result as any)];
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
        return [null, createValue(val)];
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
                 const refId = (arg as any).data;
                 // Create a Proxy that calls back the client
                 return new Proxy(function() {}, {
                     apply: async (_, __, callArgs) => {
                         // Open stream to client
                         const substream = await getStreamPool().acquire();
                         // Send execute instruction
                         // Target is the Reference ID.
                         // We construct instructions: [Reference(ID), Apply(Args)]
                         const instructions: ProxyInstructions[] = [
                             { kind: ProxyValueKinds.Reference, data: refId, id: muid().toString() },
                             createInstructionUnsafe(ProxyInstructionKinds.apply, callArgs)
                             // Note: callArgs might need hydration too if complex!
                             // For now assuming primitives or handled by encoder logic?
                             // Encoder logic in imported.ts handles recursive createValue? 
                             // No, encoder handles msgpack. 
                             // We should use createValue here too if we want to pass Server Objects back to Client Callback!
                             // But createValue is local.
                         ];
                         
                         // We need to map callArgs using createValue?
                         // Yes, if we want to support passing Server objects to Client callbacks.
                         const transformedCallArgs = callArgs.map(a => createValue(a));
                         // Re-create apply instruction with transformed args
                         const finalInstructions: ProxyInstructions[] = [
                            { kind: ProxyValueKinds.Reference, data: refId, id: muid().toString() },
                            createInstructionUnsafe(ProxyInstructionKinds.apply, transformedCallArgs)
                         ];

                         const execInstruction = createInstructionUnsafe(
                             ProxyInstructionKinds.execute,
                             finalInstructions
                         );
                         
                         return new Promise((resolve, reject) => {
                             const cleanup = () => {
                                 substream.removeAllListeners("data");
                                 substream.removeAllListeners("error");
                                 getStreamPool().release(substream);
                             };
                             substream.on("data", (d) => {
                                 const [err, res] = decode(d, [ProxyInstructionKinds.return, ProxyInstructionKinds.throw] as any);
                                 if (err) {
                                     reject(new Error(err.message));
                                 } else {
                                     const val = (res as any).data; 
                                     resolve(val?.data ?? val);
                                 }
                                 cleanup();
                             });
                             substream.on('error', (error) => {
                                 cleanup();
                                 reject(error);
                             });
                             substream.write(Buffer.from(encode(execInstruction)));
                         });
                     },

                 });
             }
             if (arg && typeof arg === "object" && "data" in (arg as any)) {
                 return (arg as any).data;
             }
             return arg;
         });

         if (typeof target === 'function') {
             const result = await Reflect.apply(target, object, args); 
             return [null, createValue(result)];
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
                 const refId = (arg as any).data;
                 return new Proxy(function() {}, {
                     apply: async (_, __, callArgs) => {
                         const substream = await getStreamPool().acquire();
                         const transformedCallArgs = callArgs.map(a => createValue(a));
                         const finalInstructions: ProxyInstructions[] = [
                            { kind: ProxyValueKinds.Reference, data: refId, id: muid().toString() },
                            createInstructionUnsafe(ProxyInstructionKinds.apply, transformedCallArgs)
                         ];
                         const execInstruction = createInstructionUnsafe(ProxyInstructionKinds.execute, finalInstructions);
                         return new Promise((resolve, reject) => {
                             const cleanup = () => {
                                 substream.removeAllListeners("data");
                                 substream.removeAllListeners("error");
                                 getStreamPool().release(substream);
                             };
                             substream.on("data", (d) => {
                                 const [err, res] = decode(d, [ProxyInstructionKinds.return, ProxyInstructionKinds.throw] as any);
                                 if (err) reject(new Error(err.message));
                                 else resolve((res as any).data?.data ?? (res as any).data);
                                 cleanup();
                             });
                             substream.on('error', (error) => {
                                 cleanup();
                                 reject(error);
                             });
                             substream.write(Buffer.from(encode(execInstruction)));
                         });
                     }
                 });
             }
             if (arg && typeof arg === "object" && "data" in (arg as any)) {
                 return (arg as any).data;
             }
             return arg;
         });

         if (typeof target === 'function') { // constructor
             const result = Reflect.construct(target, args);
             return [null, createValue(result)];
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
          return [null, createValue(undefined)];
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
  const server = createProxyableServer(handler);
  if (parameters.stream) {
    parameters.stream.pipe(server as any).pipe(parameters.stream);
  }

  return new Proxy(object, handler) as ProxyableExport<TObject>;
}
