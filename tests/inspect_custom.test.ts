import "source-map-support/register";
import { describe, it, expect } from "vitest";
import { inspect } from "util";
import { ProxyableSymbol } from "../src/symbol";
import { createExportedProxyable } from "../src/exported";
import { createImportedProxyable } from "../src/imported";

describe("custom inspect", () => {
  it("should provide helpful, side-effect free inspection", async () => {
    const object = {
      value: "ok",
      getObj: () => ({ nested: "hi" }),
    };

    const local = createExportedProxyable({ object });
    const remote = createImportedProxyable<typeof object>({
      stream: local[ProxyableSymbol.handler].stream as any,
    });

    expect(inspect(remote)).toBe("ProxyableImport(root)");

    const pending = (remote as any).value;
    expect(inspect(pending)).toMatch(/^ProxyableImport\(pending:/);

    const obj = await remote.getObj();
    expect(inspect(obj)).toMatch(/^ProxyableImport\(ref:/);
  });
});
