import {
  createClient,
  type ClientOptions,
  type Session,
  type Stream,
} from "@stateforward/yamux.ts";
import { createDecoder } from "./decoder";
import {
  createInstructionUnsafe,
  createThrowInstruction,
  createReleaseInstruction,
  createReturnInstruction,
} from "./instructions";
import {
  ProxyInstructionDecoder,
  ProxyInstructionEncoder,
  ProxyableHandler,
  InferProxyInstruction,
  ProxyInstructionKinds,
  ProxyInstruction,
  ProxyableImport,
  ProxyInstructions,
  ProxyExecuteResult,
  ProxyValueKinds,
  ProxyReturnInstruction,
  ProxyablePrimitiveUnknown,
  UnproxyableValue,
} from "./types";
import { createEncoder } from "./encoder";
import { make as muid } from "./muid";
import { ProxyableSymbol } from "./symbol";
import { logger } from "./logger";
import { ObjectRegistry } from "./registry";
import { StreamPool } from "./stream_pool";
import {
  concatBytes,
  readEachStreamChunk,
  readInstructionFromStream,
  tryDecodeInstruction,
  writeToStream,
} from "./transport";

const log = logger.child({ module: "proxyable.imported" });
const INSPECT_SYMBOL = Symbol.for("nodejs.util.inspect.custom");

type Context = {
  client: Session;
  decoder: ProxyInstructionDecoder["decode"];
  encoder: ProxyInstructionEncoder["encode"];
  registry?: FinalizationRegistry<{ refId: string }>;
  objectRegistry: ObjectRegistry;
  streamPool: StreamPool;
};

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


function createValue(registry: ObjectRegistry, value: unknown): unknown {
    if (isPrimitive(value)) {
        return value;
    }
    // If it is a function or object, register it and return Reference
    if (typeof value === "function" || (typeof value === "object" && value !== null)) {
        const id = registry.register(value);
        return {
            id: muid().toString(),
            kind: ProxyValueKinds.Reference,
            data: id
        }; 
        // Note: We return the UnproxyableValue structure directly.
        // But createInstructionUnsafe expects raw args in 'data'.
        // Wait, if we pass { kind: Reference } to MsgPack, it will encode it as an object.
        // The Decoder on the other side must recognize this object as a Reference and hydrate it.
        // Current 'exported.ts' unwrap logic handles `ProxyValueKinds.Reference`.
    }
    return value;
}

function unwrapResult(result: ProxyInstruction, context: Context): unknown {
  if (result.kind === ProxyInstructionKinds.return) {
    const returnInstr = result as ProxyReturnInstruction;
    const value = returnInstr.data as UnproxyableValue<unknown>;
    
    // Handle Reference types
    if (value.kind === ProxyValueKinds.Reference) {
        log.info({ refId: value.data }, "hydrating reference");
        // Return a proxy that starts with this reference as a specific "Load" instruction
        // We simulate a "Load" by creating an instruction with kind=Reference
        const proxy = createProxyCursor(context, [{
            id: muid().toString(),
            kind: ProxyValueKinds.Reference,
            data: value.data as string
        }]);
        
        if (context.registry) {
            context.registry.register(proxy, { refId: value.data as string });
        }
        
        return proxy;
    }
    
    if (value.kind === ProxyValueKinds.undefined) {
        return undefined;
    }
    if (value.kind === ProxyValueKinds.null) {
        return null;
    }

    return value.data;
  }

  return result;
}

function unwrapArgumentValue(arg: unknown, context: Context): unknown {
  if (!arg || typeof arg !== "object" || !("kind" in (arg as any))) {
    return arg;
  }
  const wrapped = arg as any;
  if (wrapped.kind === ProxyValueKinds.Reference) {
    return unwrapResult(
      {
        id: wrapped.id ?? muid().toString(),
        kind: ProxyInstructionKinds.return,
        data: wrapped,
      } as any,
      context
    );
  }
  if (wrapped.kind === ProxyValueKinds.undefined) {
    return undefined;
  }
  if (wrapped.kind === ProxyValueKinds.null) {
    return null;
  }
  return "data" in wrapped ? wrapped.data : arg;
}

function createProxyCursor<TObject extends object>(
  context: Context,
  instructions: ProxyInstructions[]
): ProxyableImport<TObject> {
  // We use a regular function as the target to allow both 'apply' and 'construct' traps.
  // Arrow functions cannot be used for construction.
  const object = Object.defineProperties(function () {}, {
    name: { value: `ProxyableImport` }, // ID is harder to track per cursor, maybe unnecessary?
    [Symbol.toStringTag]: { value: "ProxyableImport" },
    [INSPECT_SYMBOL]: {
      value: () => {
        if (instructions.length === 0) return "ProxyableImport(root)";
        if (
          instructions.length === 1 &&
          instructions[0].kind === ProxyValueKinds.Reference
        ) {
          return `ProxyableImport(ref:${String(instructions[0].data)})`;
        }
        const kinds = instructions.map((instruction) => instruction.kind);
        return `ProxyableImport(pending:${kinds.join(",")})`;
      },
    },
  });

  const handler: ProxyHandler<any> = {
    get: (_, key: PropertyKey) => {
      // 1. Handle special symbols
      if (key === ProxyableSymbol.id) return "UNKNOWN";
      if (key === ProxyableSymbol.handler) return handler;
      if (key === Symbol.toStringTag) return "ProxyableImport";
      if (key === INSPECT_SYMBOL) {
        return () => {
          if (instructions.length === 0) return "ProxyableImport(root)";
          if (
            instructions.length === 1 &&
            instructions[0].kind === ProxyValueKinds.Reference
          ) {
            return `ProxyableImport(ref:${String(instructions[0].data)})`;
          }
          const kinds = instructions.map((instruction) => instruction.kind);
          return `ProxyableImport(pending:${kinds.join(",")})`;
        };
      }

      // 2. Handle 'then' for await execution
      const isReferenceHolder = instructions.length === 1 && instructions[0].kind === ProxyValueKinds.Reference;
      
      if (key === "then") {
        if (instructions.length === 0 || isReferenceHolder) return undefined;
        
        return (
          resolve: (value: unknown) => void,
          reject: (reason: unknown) => void
        ) => {
          // Trigger Execution
          executeInstructions(context, instructions)
            .then(([err, res]) => {
              if (err) return reject(err);
              try {
                // Pass context to unwrapResult
                const val = unwrapResult(res!, context);
                resolve(val);
              } catch (e) {
                reject(e);
              }
            })
            .catch(reject);
        };
      }

      // 3. Accumulate generic get instructions
      const newInstructions = [
        ...instructions,
        createInstructionUnsafe(ProxyInstructionKinds.get, [key.toString()]),
      ];
      return createProxyCursor(context, newInstructions);
    },

    apply: (_, __, args: unknown[]) => {
      const transformedArgs = args.map(arg => createValue(context.objectRegistry, arg));
      const newInstructions = [
        ...instructions,
        createInstructionUnsafe(ProxyInstructionKinds.apply, transformedArgs),
      ];
      return createProxyCursor(context, newInstructions);
    },

    construct: (_, args: unknown[]) => {
      const transformedArgs = args.map(arg => createValue(context.objectRegistry, arg));
      const newInstructions = [
        ...instructions,
        createInstructionUnsafe(ProxyInstructionKinds.construct, transformedArgs),
      ];
      return createProxyCursor(context, newInstructions);
    },
  };
  // Expose the underlying Yamux session for internal use without widening ProxyHandler typing.
  (handler as any).session = context.client;

  return new Proxy(object, handler);
}

async function executeInstructions(
  context: Context,
  instructions: ProxyInstructions[]
): Promise<ProxyExecuteResult> {
  const { encoder, decoder, streamPool } = context;
  const execInstruction = createInstructionUnsafe(
    ProxyInstructionKinds.execute,
    instructions
  );
  const substream = await streamPool.acquire();
  try {
    const bytes = encoder(execInstruction);
    log.info(
      { instruction: execInstruction },
      `sending ${execInstruction.kind} instruction`
    );
    await writeToStream(substream, bytes);
    const instruction = await readInstructionFromStream(substream, decoder, [
      ProxyInstructionKinds.throw,
      ProxyInstructionKinds.return,
      ProxyInstructionKinds.next,
    ]);
    if (!instruction) {
      throw new Error("yamux stream closed before response");
    }
    if (instruction.kind === ProxyInstructionKinds.throw) {
      return [instruction.data as any];
    }
    return [null, instruction as any];
  } finally {
    streamPool.release(substream);
  }
}

export function createImportedProxyable<TObject extends object>({
  transport,
  decoder,
  encoder,
  objectRegistry = new ObjectRegistry(),
  streamPoolSize = 8,
  streamPoolReuse = true,
}: {
  transport: ClientOptions;
  decoder?: ProxyInstructionDecoder;
  encoder?: ProxyInstructionEncoder;
  objectRegistry?: ObjectRegistry;
  streamPoolSize?: number;
  streamPoolReuse?: boolean;
}): ProxyableImport<TObject> {
  const client = createClient(transport);
  const { decode } = decoder ?? createDecoder();
  const { encode } = encoder ?? createEncoder();

  const registry = new FinalizationRegistry((heldValue: { refId: string }) => {
     void (async () => {
       try {
           const substream = await client.openStream();
           const instruction = createReleaseInstruction(heldValue.refId);
           await writeToStream(substream, encode(instruction));
           await substream.finish();
       } catch {
           // Swallow finalizer release errors once the transport is going away.
       }
     })();
  });

  const streamPool = new StreamPool({ session: client, max: streamPoolSize, reuse: streamPoolReuse });

  // Handle incoming execution requests (Callbacks)
  const handleStream = async (stream: Stream) => {
      let requestBuffer = new Uint8Array();
      await readEachStreamChunk(stream, async (data) => {
          requestBuffer = concatBytes(requestBuffer, data);
          const instruction = tryDecodeInstruction(decode, requestBuffer, [
            ProxyInstructionKinds.execute,
            ProxyInstructionKinds.release,
          ]);

          if (!instruction) {
              return;
          }
          requestBuffer = new Uint8Array();

          // Evaluate logic (Simplified version of exported.ts handler)
          const execute = async () => {
              if (instruction.kind === ProxyInstructionKinds.release) {
                 const [refId] = instruction.data as any;
                 objectRegistry.delete(refId);
                 return createValue(objectRegistry, undefined);
              }

              if (instruction.kind === ProxyInstructionKinds.execute) {
                 const stack: ProxyInstruction[] = [];
                 const instructions = instruction.data as ProxyInstruction[];
                 
                 for (const instr of instructions) {
                     if (instr.kind === ProxyValueKinds.Reference) {
                         stack.push(instr);
                         continue;
                     }

                     // Resolve target
                     let target: any = undefined; // Default? Or fail if no target?
                     // For callbacks, we EXPECT a target in stack (Reference)
                     if (stack.length > 0) {
                         const head = stack[stack.length - 1];
                         if (head.kind === ProxyValueKinds.Reference) {
                             target = objectRegistry.get(head.data as string);
                             // Consuming the reference from stack for the operation
                             stack.pop();
                         }
                     }

                     if (!target) {
                         return createThrowInstruction({ message: "No target for operation" });
                     }

                     if (instr.kind === ProxyInstructionKinds.get) {
                         try {
                             const [key] = instr.data as [string];
                             const value = target[key];
                             const nextValue =
                               typeof value === "function" ? value.bind(target) : value;
                             stack.push(createValue(objectRegistry, nextValue) as any);
                             continue;
                         } catch (e: any) {
                             return createThrowInstruction({ message: e.message });
                         }
                     }

                     if (instr.kind === ProxyInstructionKinds.apply) {
                         // Apply on target
                         if (typeof target === 'function') {
                             try {
                                 // We need to hydrate arguments!
                                 const args = (instr.data as unknown[]).map(arg => {
                                     return unwrapArgumentValue(arg, { client, decoder: decode, encoder: encode, registry, objectRegistry, streamPool });
                                 });

                                 const result = await Reflect.apply(target, undefined, args);
                                 // Result needs to be encoded via createValue
                                 return createReturnInstruction(createValue(objectRegistry, result) as any);
                             } catch (e: any) {
                                 return createThrowInstruction({ message: e.message });
                             }
                         }
                     }

                 }
                 
                 // If stack has result, return it
                 if (stack.length > 0) {
                     return createReturnInstruction(stack.pop() as any);
                 }
                 return createReturnInstruction(createValue(objectRegistry, undefined) as any);
              }
              return createThrowInstruction({ message: "Unknown instruction" });
          };

          try {
              const res = await execute(); // evaluate
              // Encode result
              await writeToStream(stream, encode(res));
          } catch (e: any) {
              await writeToStream(stream, encode(createThrowInstruction({ message: e.message })));
          }
      });
  };

  void (async () => {
    for (;;) {
      try {
        void handleStream(await client.acceptStream()).catch((error) => {
          log.error({ error }, "yamux callback stream handler failed");
        });
      } catch (error) {
        log.debug({ error }, "stopped accepting yamux callback streams");
        return;
      }
    }
  })();

  return createProxyCursor<TObject>(
    { client, decoder: decode, encoder: encode, registry, objectRegistry, streamPool },
    []
  );
}
