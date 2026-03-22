import "source-map-support/register";
import { describe, it, expect } from "vitest";
import { ProxyableSymbol } from "../src/symbol";
import { createExportedProxyable } from "../src/exported";
import { createImportedProxyable } from "../src/imported";

describe("thenable trigger", () => {
  it("should only be thenable when there are pending instructions", async () => {
    const object = {
      value: "ok",
      getObj: () => ({ nested: "hi" }),
    };

    const local = createExportedProxyable({ object });
    const remote = createImportedProxyable<typeof object>({
      stream: local[ProxyableSymbol.handler].stream as any,
    });

    // Root proxy should not be thenable (prevents accidental execution on inspect).
    expect((remote as any).then).toBeUndefined();

    // Pending instructions should still resolve via await.
    const value = await remote.value;
    expect(value).toBe("ok");

    // Reference-only proxy should not be thenable.
    const obj = await remote.getObj();
    expect((obj as any).then).toBeUndefined();
    const nested = await obj.nested;
    expect(nested).toBe("hi");
  });
});
