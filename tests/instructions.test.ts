
import { describe, it, expect } from "vitest";
import { 
    createGetInstruction, 
    createApplyInstruction, 
    ValidationError 
} from "../src/instructions";

describe("instructions", () => {
  describe("createGetInstruction", () => {
    it("should create valid get instruction", () => {
      const instr = createGetInstruction(["key"]);
      expect(instr.data).toEqual(["key"]);
    });

    it("should fail on invalid data", () => {
      expect(() => createGetInstruction(undefined)).not.toThrow(); // Validator allows undefined?
      // Let's check validator: data === undefined || (Array.isArray(data) ... string)
      
      expect(() => createGetInstruction(["a", 1 as any])).toThrow(ValidationError);
      expect(() => createGetInstruction("string" as any)).toThrow(ValidationError);
    });
  });

  describe("createApplyInstruction", () => {
    it("should create valid apply instruction", () => {
      const instr = createApplyInstruction([1, 2]);
      expect(instr.data).toEqual([1, 2]);
    });

    it("should fail on invalid data", () => {
       expect(() => createApplyInstruction("not-an-array" as any)).toThrow(ValidationError);
    });
  });
});
