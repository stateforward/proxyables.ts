
import "source-map-support/register";
import { describe, it, expect } from "vitest";
import { Proxyable } from "../src";
import { ProxyableSymbol } from "../src/symbol";
import { ObjectRegistry } from "../src/exported";

// Helper to wait for GC
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("memory leak", () => {
  it("should release references when proxy is garbage collected", async () => {
    // 1. Setup
    const registry = new ObjectRegistry();
    const object = {
      nested: { data: "hello" },
    };
    
    // Inject our registry
    // Note: We need to use createExportedProxyable directly or patch Proxyable.export
    // But Proxyable.export calls createExportedProxyable.
    // We can't easily inject into Proxyable.export without changing its signature too.
    // So let's use createExportedProxyable directly.
    
    const { createExportedProxyable } = await import("../src/exported");
    const exported = createExportedProxyable({ object, registry });
    
    const { createImportedProxyable } = await import("../src/imported");
    const remote = createImportedProxyable<typeof object>({
      stream: exported[ProxyableSymbol.handler].stream as any,
    });

    // 2. Create Reference
    expect(registry.size).toBe(0);
    
    // Accessing 'nested' creates a reference on server
    let nested: any = await remote.nested;
    const data = await nested.data;
    expect(data).toBe("hello");
    
    // There should be 1 object in registry (the 'nested' object)
    expect(registry.size).toBe(1);
    
    // 3. Drop Reference and GC
    nested = null; // Remove strong reference
    
    // Trigger GC
    if (global.gc) {
        global.gc();
    } else {
        console.warn("Garbage collection not exposed. Run with --expose-gc");
        // Verify we can't test it without GC
        return; 
    }
    
    // Wait for FinalizationRegistry (async)
    // It might take multiple ticks or GCs.
    await wait(100);
    if (global.gc) global.gc();
    await wait(100);
    
    // 4. Verify Release
    // This is flaky if GC doesn't run, but with --expose-gc and forced gc it should work.
    expect(registry.size).toBe(0);
  });
});
