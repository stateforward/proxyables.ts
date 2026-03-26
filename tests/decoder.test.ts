
import { describe, it, expect } from "vitest";
import { createDecoder, isInstruction, isArrayOfInstructions } from "../src/decoder";
import { ProxyInstructionKinds } from "../src/types";

describe("decoder", () => {
  it("should validate instructions correctly", () => {
    expect(isInstruction({ kind: 1, data: "test" })).toBe(true);
    expect(isInstruction(null)).toBe(false);
    expect(isInstruction({})).toBe(false);
    expect(isInstruction({ kind: 1 })).toBe(true);
  });

  it("should validate array of instructions correctly", () => {
    expect(isArrayOfInstructions([])).toBe(true);
    expect(isArrayOfInstructions([{ kind: 1, data: "test" }])).toBe(true);
    expect(isArrayOfInstructions([{ kind: 1 }, { kind: 2 }])).toBe(true);
    expect(isArrayOfInstructions(null)).toBe(false);
    expect(isArrayOfInstructions({})).toBe(false);
    expect(isArrayOfInstructions(["test"])).toBe(false);
  });

  describe("createDecoder", () => {
    const decoder = createDecoder();

    it("should fail on invalid data types", () => {
        // Mocking invalid packed data requires careful construction or just passing garbage to decodePackedMessage if possible.
        // But `decode` takes ArrayLike<number> | BufferSource.
        // Let's rely on valid msgpack checks.
        // If we pass an empty buffer, msgpack might throw or return undefined?
        // Let's test `decode` function's handling of non-object results from msgpack if possible, 
        // or just invalid structures that ARE objects but miss 'kind'.
        
        // Since we can't easily mock `msgpack.decode` here without more setup, 
        // we can test the logic by passing valid msgpack that decodes to invalid JS objects.
        
        // Actually, `decoder.decode` takes bytes.
        // We can't inject an object directly unless we bypass typescript or use `createEncoder` to create bad data?
        // No, encoder reinforces structure.
        
        // We can just rely on the component tests for `decode` logic if we assume msgpack works.
        // Let's verify `decode` logic when msgpack returns an object without `kind`.
        // To do this via `decode`, we'd need to encode `{ foo: "bar" }` and pass it.
        
        // Let's use `msgpack` to encode bad data.
        const { encode } = require("@msgpack/msgpack");
        
        const badData = encode({ foo: "bar" });
        const [err] = decoder.decode(badData);
        expect(err).toBeDefined();
        expect(err?.message).toContain("invalid data");
    });
    
    it("should fail on non-object msgpack result", () => {
        const { encode } = require("@msgpack/msgpack");
        const badData = encode("just a string");
        const [err] = decoder.decode(badData);
        expect(err).toBeDefined();
        expect(err?.message).toContain("invalid data");
    });

    it("should filter by kind", () => {
         const { encode } = require("@msgpack/msgpack");
         const data = encode({ kind: ProxyInstructionKinds.get, data: ["a"] });
         
         // Should pass if kind matches
         const [err1, res1] = decoder.decode(data, [ProxyInstructionKinds.get]);
         expect(err1).toBeNull();
         expect(res1?.kind).toBe(ProxyInstructionKinds.get);
         
         // Should fail if kind excluded
         const [err2] = decoder.decode(data, [ProxyInstructionKinds.set]);
         expect(err2).toBeDefined();
         expect(err2?.message).toContain("invalid instruction kind");
    });
    

    it("should decode execute instructions with validation", () => {
        // Execute expects data to be ProxyInstructions[]
        const { encode } = require("@msgpack/msgpack");
        
        // Valid
        const validPayload = { 
            kind: ProxyInstructionKinds.execute, 
            data: [{ kind: ProxyInstructionKinds.get, data: ["a"] }] 
        };
        const [err1, res1] = decoder.decode(encode(validPayload));
        expect(err1).toBeNull();
        
        // Invalid data shape for execute
        const invalidPayload = {
            kind: ProxyInstructionKinds.execute,
            data: "not an array"
        };
        const [err2] = decoder.decode(encode(invalidPayload));
        expect(err2).toBeDefined();
        expect(err2?.message).toContain("invalid execution data");
    });

    it("should decode apply instruction", () => {
        const { encode } = require("@msgpack/msgpack");
        const payload = { kind: ProxyInstructionKinds.apply, data: [1, 2] };
        const [err, res] = decoder.decode(encode(payload));
        expect(err).toBeNull();
        expect(res?.kind).toBe(ProxyInstructionKinds.apply);
        expect(res?.data).toEqual([1, 2]);
    });

    it("should decode construct instruction", () => {
        const { encode } = require("@msgpack/msgpack");
        const payload = { kind: ProxyInstructionKinds.construct, data: [1, 2] };
        const [err, res] = decoder.decode(encode(payload));
        expect(err).toBeNull();
        expect(res?.kind).toBe(ProxyInstructionKinds.construct);
    });

    it("should decode next instruction", () => {
        const { encode } = require("@msgpack/msgpack");
        const payload = { kind: ProxyInstructionKinds.next };
        const [err, res] = decoder.decode(encode(payload));
        expect(err).toBeNull();
        expect(res?.kind).toBe(ProxyInstructionKinds.next);
    });
    
    it("should use fallback for unknown instructions", () => {
        const { encode } = require("@msgpack/msgpack");
        const payload = { kind: 999999, data: "test" };
        const [err, res] = decoder.decode(encode(payload));
        expect(err).toBeNull();
        expect(res?.kind).toBe(999999);
        expect(res?.data).toBe("test");
    });

  });
});
