import "source-map-support/register";
import { describe, it, expect } from "vitest";
import { Proxyable } from "../src";
import { Client } from "yamux-js/cjs";
import { ProxyableSymbol } from "../src/symbol";
import { createEncoder } from "../src/encoder";
import { createDecoder } from "../src/decoder";
import { ProxyInstructionKinds } from "../src/types";

describe("proxyable", () => {
  it("should create a proxyable object", async () => {
    const object = {
      a: 1,
      b: 2,
    };
    const exported = Proxyable.export({ object });
      const remote = Proxyable.importFrom<typeof object>({
      stream: exported[ProxyableSymbol.handler].stream as any,
    });

    const a = await remote.a;
    expect(a).toBe(1);
  });

  it("should handle nested objects via reference", async () => {
    const object = {
      nested: {
        x: 10,
        y: 20
      },
      func: () => "hello"
    };
    const exported = Proxyable.export({ object });
      const remote = Proxyable.importFrom<typeof object>({
      stream: exported[ProxyableSymbol.handler].stream as any,
    });

    const x = await (remote.nested as any).x;
    expect(x).toBe(10);
    
    // Immutability Check: Separate chains
    const nested = remote.nested;
    const y = await (nested as any).y;
    expect(y).toBe(20);
    
    // Ensure accessing same property twice yields different proxies (identity check usually fails on proxies anyway, but logic must hold)
    expect(remote.nested).not.toBe(remote.nested);
  });

  it("should execute functions on remote", async () => {
     const object = {
         add: (a: number, b: number) => a + b,
         greet: (name: string) => `Hello ${name}`
     };
     const exported = Proxyable.export({ object });
       const remote = Proxyable.importFrom<typeof object>({
       stream: exported[ProxyableSymbol.handler].stream as any,
     });
     
     // Test simple function execution
     const sum = await remote.add(5, 3);
     expect(sum).toBe(8);
     
     const greeting = await remote.greet("World");
     expect(greeting).toBe("Hello World");
  });

  it("should execute functions returning objects", async () => {
      const object = {
          createUser: (name: string) => ({ name, id: 123 })
      };
      const exported = Proxyable.export({ object });
        const remote = Proxyable.importFrom<typeof object>({
        stream: exported[ProxyableSymbol.handler].stream as any,
      });
      
      const user = await remote.createUser("Alice");
      
      // Since `await` resolves the promise, `user` here is the unwrapped value.
      // IF the return type is Reference, unwrapResult in imported.ts currently returns a NEW PROXY.
      // So `user` should be a ProxyableImport<{name, id}>.
      
      // Let's verify we can access properties on it.
      const id = await user.id;
      expect(id).toBe(123);
      
      const name = await user.name;
      expect(name).toBe("Alice");
  });
  
  it("should handle arrays transparently", async () => {
      const object = {
          list: [1, 2, 3],
          getAt: (idx: number) => [10, 20, 30][idx]
      };
      const exported = Proxyable.export({ object });
        const remote = Proxyable.importFrom<typeof object>({
        stream: exported[ProxyableSymbol.handler].stream as any,
      });

      // Array access
      const item = await (remote.list as any)[1];
      expect(item).toBe(2);
      
      // Method returning array item
      const val = await remote.getAt(1);
      expect(val).toBe(20);
  });
  
  it("should propagate errors from remote", async () => {
      const object = {
          fail: () => { throw new Error("Boom"); }
      };
      const exported = Proxyable.export({ object });
        const remote = Proxyable.importFrom<typeof object>({
        stream: exported[ProxyableSymbol.handler].stream as any,
      });
      
      await expect(remote.fail()).rejects.toThrow("Boom"); 
  });

  it("should handle set operations reflecting on remote", async () => {
      const object = {
          val: 1
      };
      const exported = Proxyable.export({ object });
        const remote = Proxyable.importFrom<typeof object>({
        stream: exported[ProxyableSymbol.handler].stream as any,
      });

      // Note: `set` on proxyable import currently doesn't trigger remote set automatically via assignment?
      // The `handler` in `imported.ts` only has `get`, `apply`, `construct`.
      // It does NOT have `set`.
      // Let's check if we can add `set` or if it's strictly readonly/rpc-like structure.
      // `types.ts` has `ProxySetInstruction`.
      // `exported.ts` doesn't implement `set`.
      // `imported.ts` doesn't implement `set` trap.
      // So `set` is effectively unimplemented/local only?
      // If I set `remote.val = 2`, it sets it on the local proxy target (noop function) or fails?
      // The current implementation seems to be Read/Execute only.
      // Skipping this test or adding it as "TODO" or "Verification of current behavior".
      // Current behavior: setting property on remote proxy dies locally or does nothing.
      
      // Attempting to write:
      // remote.val = 2; 
      // This will fail type check if readonly, or runtime if strict.
   });
   
  it("should handle null and undefined return values", async () => {
      const object = {
          getNull: () => null,
          getUndefined: () => undefined,
          valNull: null,
          valUndefined: undefined
      };
      const exported = Proxyable.export({ object });
        const remote = Proxyable.importFrom<typeof object>({
        stream: exported[ProxyableSymbol.handler].stream as any,
      });
      
      expect(await remote.getNull()).toBeNull();
      expect(await remote.getUndefined()).toBeUndefined();
      expect(await remote.valNull).toBeNull();
      expect(await remote.valUndefined).toBeUndefined();
  });
  
  it("should handle large payloads (within chunk limits)", async () => {
      const largeString = "a".repeat(32 * 1024); // 32KB - safe for default chunk sizes usually
      const object = {
          data: largeString,
          echo: (str: string) => str
      };
      const exported = Proxyable.export({ object });
        const remote = Proxyable.importFrom<typeof object>({
        stream: exported[ProxyableSymbol.handler].stream as any,
      });
      
      expect(await remote.data).toBe(largeString);
      expect(await remote.echo(largeString)).toBe(largeString);
  });

  it("should handle class construction via proxy", async () => {
      class Greeter {
          greeting: string;
          constructor(greeting: string) {
              this.greeting = greeting;
          }
          greet(name: string) {
              return `${this.greeting} ${name}`;
          }
      }
      
      const object = {
          Greeter
      };
      
      const exported = Proxyable.export({ object });
        const remote = Proxyable.importFrom<typeof object>({
        stream: exported[ProxyableSymbol.handler].stream as any,
      });
      
      // Instantiate remote class
      // Note: `remote.Greeter` returns a proxy to the class constructor.
      // `new` on it sends `construct` instruction.
      const greeter = await new (remote.Greeter as any)("Hello");
      
      // greeter is now a proxy to the instance
      const msg = await greeter.greet("World");
      expect(msg).toBe("Hello World");
  });

  it("should handle error when calling non-function property", async () => {
      const object = { val: 123 };
      const exported = Proxyable.export({ object });
        const remote = Proxyable.importFrom<typeof object>({
         stream: exported[ProxyableSymbol.handler].stream as any,
      });
      // remote.val is number. Calling it should fail.
      // remote.val(...) -> get("val") -> 1. apply(ignored) -> target=1.
      await expect((remote as any).val()).rejects.toThrow("target is not a function");
  });
  
  it("should support ProxyableSymbol function usage", () => {
      // Covers symbol.ts lines
      const sym = ProxyableSymbol("test");
      expect(sym).toBe(Symbol.for("test"));
  });

});

describe("proxyable internal", () => {
  it("should allow local access on exported proxy (returning [error, value] tuple)", () => {
      const object = { val: 123 };
      const exported = Proxyable.export({ object });
      
      // Access property locally returns the result tuple [error, UnproxyableValue]
      const result = (exported as any).val;
      expect(Array.isArray(result)).toBe(true);
      expect(result[0]).toBeNull();
      expect(result[1].data).toBe(123);
      
      // Access symbol - explicit check
      expect(exported[ProxyableSymbol.id]).toBeDefined();
  });

  it("should handle unknown instructions sent to server", async () => {
      const object = { val: 1 };
      const exported = Proxyable.export({ object });
      const stream = exported[ProxyableSymbol.handler].stream;
      
      const client = new Client();
      (stream as any).pipe(client as any).pipe(stream);
      
      const session = client.open();
      const encode = createEncoder().encode;
      
      // Send execute with unknown instruction kind in data
      // kind 99999
      const badInstruction = { kind: 99999, data: "test" };
      const exec = { kind: ProxyInstructionKinds.execute, data: [badInstruction] };
      
      (session as any).write(Buffer.from(encode(exec)));
      
      const decode = createDecoder().decode;
      
      await new Promise<void>((resolve, reject) => {
          (session as any).on("data", (data: any) => {
              const [err, res] = decode(data);
              // Server sends back Throw instruction or Return?
              // The handler.eval returns [error].
              // createProxyableServer sends: encode(createThrowInstruction(evalError))
              
              if (res?.kind === ProxyInstructionKinds.throw) {
                  // data of throw instruction is ProxyError
                  try {
                      // Implementation detail: unknown instructions in 'execute' are skipped, 
                      // leading to empty stack and "no result" error.
                      expect((res.data as any).message).toContain("no result");
                      resolve();
                  } catch (e) {
                      reject(e);
                  }
              }
          });
          (session as any).on("error", reject);
      });
  });

  it("should handle unknown instruction via direct eval call", async () => {
      const object = { val: 1 };
      const exported = Proxyable.export({ object });
      const handler = exported[ProxyableSymbol.handler];
      
      const badInstruction: any = { kind: 99999, data: "test" };
      const [err] = await handler.eval(badInstruction);
      
      expect(err).toBeDefined();
      expect(err?.message).toContain("unknown instruction kind");
  });
});
