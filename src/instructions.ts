import { make as muid } from "./muid";
import {
  InferProxyInstruction,
  ProxyApplyInstruction,
  ProxyError,
  ProxyGetInstruction,
  ProxyInstructionData,
  ProxyInstructionKinds,
  ProxyReleaseInstruction,
  ProxyablePrimitiveUnknown,
} from "./types";

export class ValidationError extends Error {}

export function createInstructionUnsafe<TKind extends ProxyInstructionKinds>(
  kind: TKind,
  data: ProxyInstructionData<TKind>
): InferProxyInstruction<TKind> {
  return {
    id: muid().toString(),
    kind,
    data,
  } as InferProxyInstruction<TKind>;
}

function createInstructionDataValidator<TKind extends ProxyInstructionKinds>(
  kind: TKind,
  validate: (data: unknown) => boolean
): (data: unknown) => ProxyInstructionData<TKind> {
  return (data: unknown) => {
    if (validate(data)) {
      return data as ProxyInstructionData<TKind>;
    }
    throw new ValidationError(
      `Invalid '${kind}' instruction data: ${JSON.stringify(data)}`
    );
  };
}

const getInstructionDataValidator = createInstructionDataValidator(
  ProxyInstructionKinds.get,
  (data) =>
    data === undefined ||
    (Array.isArray(data) &&
      data.filter((item) => typeof item === "string").length === data.length)
);

export function createGetInstruction(
  data?: [string, string] | [string],
  validate = getInstructionDataValidator
): ProxyGetInstruction {
  return createInstructionUnsafe(ProxyInstructionKinds.get, validate(data));
}

const applyInstructionDataValidator = createInstructionDataValidator(
  ProxyInstructionKinds.apply,
  (data) => Array.isArray(data)
);

export function createApplyInstruction(
  data: unknown[],
  validate = applyInstructionDataValidator
): ProxyApplyInstruction {
  return createInstructionUnsafe(ProxyInstructionKinds.apply, validate(data));
}

export function createThrowInstruction(
  data: ProxyError
): InferProxyInstruction<ProxyInstructionKinds.throw> {
  return createInstructionUnsafe(ProxyInstructionKinds.throw, data);
}

export function createReturnInstruction(
  data: ProxyablePrimitiveUnknown
): InferProxyInstruction<ProxyInstructionKinds.return> {
  return createInstructionUnsafe(ProxyInstructionKinds.return, data);
}

export function createReleaseInstruction(
  refId: string
): InferProxyInstruction<ProxyInstructionKinds.release> {
  return createInstructionUnsafe(ProxyInstructionKinds.release, [refId]);
}
