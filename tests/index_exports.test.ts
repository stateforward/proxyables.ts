import { describe, expect, it } from "vitest";
import * as api from "../src";

describe("package exports", () => {
  it("exposes the shared core modules from the root entrypoint", () => {
    expect(api).toMatchObject({
      Proxyable: expect.any(Function),
      createDecoder: expect.any(Function),
      createEncoder: expect.any(Function),
      createExportedProxyable: expect.any(Function),
      createImportedProxyable: expect.any(Function),
    });
  });
});
