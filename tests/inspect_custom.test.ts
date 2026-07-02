import "source-map-support/register";
import { describe, it, expect } from "vitest";
import { inspect } from "util";
import { createExportedProxyable } from "../src/exported";
import { createImportedProxyable } from "../src/imported";
import { createTransportPair } from "./helpers";

describe("custom inspect", () => {
  it("should provide helpful, side-effect free inspection", async () => {
    const object = {
      value: "ok",
      getObj: () => ({ nested: "hi" }),
    };

    const transport = createTransportPair();
    createExportedProxyable({ object, transport: transport.server });
    const remote = createImportedProxyable<typeof object>({
      transport: transport.client,
    });

    expect(inspect(remote)).toBe("ProxyableImport(root)");

    const pending = (remote as any).value;
    expect(inspect(pending)).toMatch(/^ProxyableImport\(pending:/);

    const obj = await remote.getObj();
    expect(inspect(obj)).toMatch(/^ProxyableImport\(ref:/);
  });
});
