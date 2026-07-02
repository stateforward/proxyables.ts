import "source-map-support/register";
import { describe, it, expect } from "vitest";
import { createExportedProxyable } from "../src/exported";
import { createImportedProxyable } from "../src/imported";
import { createTransportPair } from "./helpers";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("callback check", () => {
  it("should fail or succeed to pass callback", async () => {
    // 1. Setup
    const object = {
      val: "server",
      registerCallback: (cb: () => void) => {
          serverReceivedCb = cb;
          return "registered";
      }
    };

    let serverReceivedCb: any;

    const transport = createTransportPair();
    createExportedProxyable({ object, transport: transport.server });
    const remote = createImportedProxyable<typeof object>({
        transport: transport.client,
    });

    // 2. Pass callback
    const cb = () => "hello back";
    try {
        await remote.registerCallback(cb);
        
        // Wait for server to receive it (it's sync in this test setup actually, async transport)
        // Check if server can Call it?
        expect(serverReceivedCb).toBeDefined();
        
        // Call the proxy on server side
        const result = await serverReceivedCb();
        expect(result).toBe("hello back");
        
        console.log("Callback executed successfully: " + result);
    } catch (e) {
        console.log("Failed to pass callback:", e);
        throw e;
    } finally {
        console.log("DEBUG: Entered finally block");
    }
  }, 10000);
});
