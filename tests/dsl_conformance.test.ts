import { describe, expect, it } from "vitest";
import {
  createApplyInstruction,
  createGetInstruction,
  createInstructionUnsafe,
  createReleaseInstruction,
  createReturnInstruction,
  createThrowInstruction,
} from "../src/instructions";
import { ProxyInstructionKinds, ProxyValueKinds } from "../src/types";

describe("dsl conformance", () => {
  it("uses the shared instruction and value constants", () => {
    expect(ProxyValueKinds.Reference).toBe(0x5a1b3c4d);
    expect(ProxyInstructionKinds.release).toBe(0x1a2b3c4d);
    expect(ProxyInstructionKinds.execute).toBe(0xa01e3d98);
  });

  it("builds canonical instruction shapes", () => {
    expect(createGetInstruction(["key"]).data).toEqual(["key"]);
    expect(createApplyInstruction([1, 2]).data).toEqual([1, 2]);
    expect(createReleaseInstruction("ref-1").data).toEqual(["ref-1"]);
    expect(createReturnInstruction(null as any).kind).toBe(ProxyInstructionKinds.return);
    expect(createThrowInstruction({ message: "boom" }).kind).toBe(ProxyInstructionKinds.throw);
    expect(
      createInstructionUnsafe(ProxyInstructionKinds.execute, [
        createGetInstruction(["key"]),
      ]).data
    ).toHaveLength(1);
  });
});
