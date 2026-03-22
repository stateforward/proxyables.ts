
import "source-map-support/register";
import { describe, it, expect } from "vitest";
import { Proxyable } from "../src";
import { ProxyableSymbol } from "../src/symbol";
import { ObjectRegistry } from "../src/exported";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForGC(check: () => boolean, retries = 50) {
    for (let i = 0; i < retries; i++) {
        if (global.gc) global.gc();
        await wait(100);
        if (check()) return true;
    }
    return false;
}

describe("reference counting", () => {
  it("should deduplicate IDs and reference count", { timeout: 20000 }, async () => {
    // 1. Setup
    const registry = new ObjectRegistry();
    const shared = { data: "shared" };
    const object = {
      getShared: () => shared,
    };
    
    const { createExportedProxyable } = await import("../src/exported");
    const exported = createExportedProxyable({ object, registry });
    
    const { createImportedProxyable } = await import("../src/imported");
    const remote = createImportedProxyable<typeof object>({
      stream: exported[ProxyableSymbol.handler].stream as any,
    });

    // 2. Get reference twice
    let ref1: any = await remote.getShared();
    let ref2: any = await remote.getShared();
    
    expect(await ref1.data).toBe("shared");
    expect(await ref2.data).toBe("shared");
    
    // Should be deduped in registry
    // Expected contents: Function(getShared) + Object(shared)
    // Both should have RefCount=2 (or more if internal interim steps registered them)
    // But Registry Size determines unique objects.
    expect(registry.size).toBe(2);
    
    // 3. Drop ONE reference
    ref1 = null; 
    
    // GC triggers release(ID for shared)
    // RefCount for Shared: 2 -> 1.
    // Object remains.
    await waitForGC(() => false, 5); // Just burn some cycles
    
    // Check size. Should still be 2.
    // Asserting we didn't premature delete.
    expect(registry.size).toBe(2);
    
    // Verify other proxy still works
    const data2 = await ref2.data;
    expect(data2).toBe("shared");
    
    // 4. Drop SECOND reference
    ref2 = null;
    
    // GC triggers release(ID for shared)
    // RefCount for Shared: 1 -> 0.
    // Object DELETED.
    // Function(getShared) remains (leaked).
    // Total size: 1.
    
    const success = await waitForGC(() => registry.size === 1);
    expect(success).toBe(true);
    expect(registry.size).toBe(1); // Final confirmation
    
    const contents = (registry as any).debug();
    const hasShared = contents.some((c: any) => c.obj && c.obj.data === "shared");
    expect(hasShared).toBe(false);
  });
});
