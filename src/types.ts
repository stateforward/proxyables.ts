import { Duplex } from "stream";
import { ProxyableSymbol } from "./symbol";
import { Session } from "yamux-js/cjs";

export type ProxyInstruction<
  TKind extends number = number,
  TData extends unknown = unknown
> = {
  id?: string | number;
  kind: TKind;
  data: TData;
  metadata?: unknown;
};

export enum ProxyValueKinds {
  function = 0x9ed64249,
  array = 0x8a58ad26,
  string = 0x17c16538,
  number = 0x1bd670a0,
  boolean = 0x65f46ebf,
  symbol = 0xf3fb51d1,
  object = 0xb8c60cba,
  bigint = 0x8a67a5ca,
  unknown = 0x9b759fb9,
  null = 0x77074ba4,
  undefined = 0x9b61ad43,
  Reference = 0x5a1b3c4d,
}

export type ProxySymbol<TDescription extends string | number> =
  ProxyInstruction<ProxyValueKinds.symbol, [TDescription]>;

export type InferProxyValueKind<TValue> = TValue extends {
  kind: infer TKind extends number;
}
  ? TKind
  : TValue extends string
  ? ProxyValueKinds.string
  : TValue extends number
  ? ProxyValueKinds.number
  : TValue extends boolean
  ? ProxyValueKinds.boolean
  : TValue extends undefined
  ? ProxyValueKinds.undefined
  : TValue extends Function
  ? ProxyValueKinds.function
  : TValue extends symbol
  ? ProxyValueKinds.symbol
  : TValue extends bigint
  ? ProxyValueKinds.bigint
  : TValue extends null
  ? ProxyValueKinds.null
  : TValue extends Array<unknown>
  ? ProxyValueKinds.array
  : TValue extends unknown
  ? ProxyValueKinds.unknown
  : ProxyValueKinds.object;

export type UnproxyableValue<
  TValue,
  TKind extends number | ProxyValueKinds = any
> = TValue extends ProxyInstruction ? TValue : ProxyInstruction<TKind, TValue>;

export type ProxyReferenceInstruction = ProxyInstruction<
  ProxyValueKinds.Reference,
  string // The ID of the referenced object
>;

export type ProxyablePrimitiveUnknown = UnproxyableValue<unknown>;

export enum ProxyInstructionKinds {
  local = 0x9c436708,
  get = 0x540ca757,
  set = 0xc6270703,
  apply = 0x24bc4a3b,
  construct = 0x40c09172,
  execute = 0xa01e3d98,
  throw = 0x7a78762f,
  return = 0x85ee37bf,
  next = 0x5cb68de8,
  release = 0x1a2b3c4d,
  // has = 0xedbf0fe3,
  // hasOwn = 0x534c84e5,
  // isExtensible = 0x5bf8958c,
  // ownKeys = 0xdc514bcf,
  // preventExtensions = 0x11aeb4ab,
  // getOwnPropertyDescriptor = 0x5c97e7a5,
}

export type ProxyLocalInstruction = ProxyInstruction<
  ProxyInstructionKinds.local,
  ProxyablePrimitiveUnknown
>;

export type ProxyGetInstruction = ProxyInstruction<
  ProxyInstructionKinds.get,
  [string]
>;
export type ProxySetInstruction = ProxyInstruction<
  ProxyInstructionKinds.set,
  [string, unknown]
>;
export type ProxyApplyInstruction = ProxyInstruction<
  ProxyInstructionKinds.apply,
  unknown[]
>;
export type ProxyConstructInstruction = ProxyInstruction<
  ProxyInstructionKinds.construct,
  unknown[]
>;

export type ProxyReleaseInstruction = ProxyInstruction<
  ProxyInstructionKinds.release,
  [string] // refId
>;

export type ProxyError = {
  message: string;
  cause?: ProxyError;
} & Record<string, unknown>;

export type ProxyThrowInstruction = ProxyInstruction<
  ProxyInstructionKinds.throw,
  ProxyError
>;
export type ProxyReturnInstruction = ProxyInstruction<
  ProxyInstructionKinds.return,
  ProxyablePrimitiveUnknown
>;
export type ProxyNextInstruction = ProxyInstruction<ProxyInstructionKinds.next>;
export type ProxyExecuteInstruction = ProxyInstruction<
  ProxyInstructionKinds.execute,
  ProxyInstructions[]
>;

export type ProxyExecuteResult = ProxyableInstructionResults<
  | ProxyInstructionKinds.next
  | ProxyInstructionKinds.return
  | ProxyInstructionKinds.throw
>;

export type ProxyInstructionUnknown = ProxyInstruction<
  ProxyInstructionKinds | number,
  unknown | undefined
>;

export type ProxyInstructions =
  | ProxyExecuteInstruction
  | ProxyThrowInstruction
  | ProxyReturnInstruction
  | ProxyNextInstruction
  | ProxyGetInstruction
  | ProxySetInstruction
  | ProxyApplyInstruction
  | ProxyConstructInstruction
  | ProxyReferenceInstruction
  | ProxyApplyInstruction
  | ProxyConstructInstruction
  | ProxyReferenceInstruction
  | ProxyLocalInstruction
  | ProxyReleaseInstruction;

export type ProxyInstructionData<TKind extends ProxyInstructionKinds | number> =
  TKind extends ProxyInstructionKinds
    ? Extract<ProxyInstructions, { kind: TKind }>["data"]
    : unknown;

export type InferProxyInstruction<
  TKind extends number | ProxyInstructionKinds | undefined
> = TKind extends ProxyInstructionKinds | number
  ? ProxyInstruction<TKind, ProxyInstructionData<TKind>>
  : ProxyInstructionUnknown;

export type ProxyableInstructionHandler<TObject extends object> = {
  [TKind in ProxyInstructionKinds]?: (
    data: ProxyInstructionData<TKind>,
    stack?: ProxyInstructions[],
    target?: TObject
  ) => Promise<ProxyableResults<unknown>>;
} & {
  eval: (
    instruction: ProxyInstructionUnknown,
    stack?: ProxyInstructions[]
  ) => Promise<
    ProxyableResults<UnproxyableValue<unknown> | ProxyableImport<object> | ProxyReturnInstruction | ProxyThrowInstruction>
  >;
};

export type ProxyableHandler<TObject extends object> =
  ProxyableInstructionHandler<TObject> & {
    stream: Session;
    decode: ProxyInstructionDecoder["decode"];
    encode: ProxyInstructionEncoder["encode"];
  } & ProxyHandler<TObject>;

export type ProxyableHandlerUnknown = ProxyableHandler<object>;
export type ProxyInstructionEncoder = {
  encode: (data: unknown) => Uint8Array;
};

export type ProxyableResults<TValue> = [ProxyError] | [null, TValue];
export type ProxyableInstructionResults<
  TKind extends ProxyInstructionKinds | number | undefined
> = ProxyableResults<InferProxyInstruction<TKind>>;

export type ProxyInstructionDecoder = {
  [TKind in ProxyInstructionKinds]: (
    data: ProxyInstructionUnknown
  ) => ProxyableInstructionResults<TKind>;
} & {
  [TKind in number]: (
    data: ProxyInstructionUnknown
  ) => ProxyableInstructionResults<TKind>;
} & {
  decode: <TKind extends Array<number | ProxyInstructionKinds | undefined>>(
    data: ArrayLike<number> | BufferSource,
    kind?: TKind
  ) => ProxyableInstructionResults<TKind[number]>;
};

export type ProxyableExport<TObject extends object> = TObject & {
  [ProxyableSymbol.id]: string;
  [ProxyableSymbol.handler]: ProxyableHandler<TObject>;
};

export type ProxyableImport<TObject extends object> = ((TObject extends {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new (...args: any[]): any;
}
  ? {
      new (...args: unknown[]): Promise<ProxyableImport<InstanceType<TObject>>>;
    }
  : Promise<TObject>) &
  (TObject extends object
    ? {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        [TKey in keyof TObject]: TObject[TKey] extends (...args: any[]) => any
          ? (
              ...args: Parameters<TObject[TKey]>
            ) => Promise<ProxyableImport<Awaited<ReturnType<TObject[TKey]>>>>
          :
              | Promise<
                  ProxyableImport<
                    TObject[TKey] extends object ? TObject[TKey] : never
                  >
                >
              | ProxyableImport<
                  TObject[TKey] extends object ? TObject[TKey] : never
                >;
      }
    : TObject)) & {
  [ProxyableSymbol.id]: string;
  [ProxyableSymbol.handler]: ProxyableHandlerUnknown;
};

export type ProxyableNamespaceKey<TValue = unknown> =
  | { key: string; value?: never }
  | { value: TValue; key?: never };

export type ProxyableNamespace = {
  keys: Map<unknown, string>;
  values: Map<string, unknown>;
  get: <TValue = unknown>(keyOrValue: ProxyableNamespaceKey<TValue>) => TValue;
  set: (key: string, value: unknown) => void;
  delete: (keyOrValue: ProxyableNamespaceKey) => void;
  has: (keyOrValue: ProxyableNamespaceKey) => boolean;
};
