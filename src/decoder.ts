import { createThrowInstruction } from "./instructions";
import {
  InferProxyInstruction,
  ProxyApplyInstruction,
  ProxyConstructInstruction,
  ProxyError,
  ProxyExecuteInstruction,
  ProxyGetInstruction,
  ProxyInstructionDecoder,
  ProxyInstructionKinds,
  ProxyInstructions,
  ProxyInstructionUnknown,
  ProxyNextInstruction,
  ProxyReleaseInstruction,
  ProxyableResults,
  ProxyReturnInstruction,
  ProxySetInstruction,
  ProxyThrowInstruction,
  ProxyableInstructionResults,
  ProxyLocalInstruction,
} from "./types";

import { decode, decode as decodePackedMessage } from "@msgpack/msgpack";
import { logger } from "./logger";

const log = logger.child({ module: "proxyable.decoder" });

function createDecoderError(
  message: string,
  received?: unknown,
  expected?: unknown
): ProxyError {
  log.error(
    {
      received,
      expected,
    },
    message
  );
  return {
    message,
    received,
    expected,
  };
}

export function isInstruction(data: unknown): data is ProxyInstructionUnknown {
  return typeof data === "object" && data !== null && "kind" in data;
}

export function isArrayOfInstructions(
  data: unknown
): data is ProxyInstructions[] {
  return (
    Array.isArray(data) &&
    data.every((instruction) => isInstruction(instruction))
  );
}

export function createDecoder(): ProxyInstructionDecoder {
  const decoder: ProxyInstructionDecoder = {
    [ProxyInstructionKinds.get]: (instruction: ProxyInstructionUnknown) => {
      return [null, instruction as ProxyGetInstruction];
    },
    [ProxyInstructionKinds.local]: (instruction: ProxyInstructionUnknown) => {
      return [null, instruction as ProxyLocalInstruction];
    },
    [ProxyInstructionKinds.set]: (instruction: ProxyInstructionUnknown) => {
      return [null, instruction as ProxySetInstruction];
    },
    [ProxyInstructionKinds.apply]: (instruction: ProxyInstructionUnknown) => {
      return [null, instruction as ProxyApplyInstruction];
    },
    [ProxyInstructionKinds.construct]: (
      instruction: ProxyInstructionUnknown
    ) => {
      return [null, instruction as ProxyConstructInstruction];
    },
    [ProxyInstructionKinds.throw]: (instruction: ProxyInstructionUnknown) => {
      return [null, instruction as ProxyThrowInstruction];
    },
    [ProxyInstructionKinds.return]: (instruction: ProxyInstructionUnknown) => {
      return [null, instruction as ProxyReturnInstruction];
    },
    [ProxyInstructionKinds.next]: (instruction: ProxyInstructionUnknown) => {
      return [null, instruction as ProxyNextInstruction];
    },
    [ProxyInstructionKinds.release]: (instruction: ProxyInstructionUnknown) => {
      return [null, instruction as ProxyReleaseInstruction];
    },
    [ProxyInstructionKinds.execute]: (instruction: ProxyInstructionUnknown) => {
      if (!isArrayOfInstructions(instruction.data)) {
        return [
          createDecoderError(
            `invalid execution data:`,
            instruction.data,
            "ProxyInstructions[]"
          ),
        ];
      }
      return [null, instruction as ProxyExecuteInstruction];
    },
    decode: <TKind extends Array<ProxyInstructionKinds | undefined | number>>(
      data: ArrayLike<number> | BufferSource,
      kind?: TKind
    ): ProxyableInstructionResults<TKind[number]> => {
      const object = decodePackedMessage(data);
      if (
        typeof object !== "object" ||
        object === null ||
        !("kind" in object)
      ) {
        return [createDecoderError(`invalid data`, object)];
      }
      if (kind?.length && !kind.includes(object.kind as TKind[number])) {
        return [
          createDecoderError(`invalid instruction kind`, object.kind, kind),
        ];
      }
      const decode =
        decoder[
          object.kind as TKind extends ProxyInstructionKinds ? TKind : number
        ] ??
        ((instruction: ProxyInstructionUnknown) => [
          null,
          instruction as InferProxyInstruction<TKind[number]>,
        ]);
      return decode(object as ProxyInstructionUnknown) as ProxyableInstructionResults<
        TKind[number]
      >;
    },
  };
  return decoder;
}
