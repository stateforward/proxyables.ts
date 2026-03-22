import { Session, Duplex } from 'yamux-js/cjs';

type ProxyableSymbolFunction = ((description: string | number) => symbol) & {
    readonly handler: unique symbol;
    readonly id: unique symbol;
    readonly kind: unique symbol;
    readonly schema: unique symbol;
};
declare const ProxyableSymbol: ProxyableSymbolFunction;

type ProxyInstruction<TKind extends number = number, TData extends unknown = unknown> = {
    id?: string | number;
    kind: TKind;
    data: TData;
    metadata?: unknown;
};
declare enum ProxyValueKinds {
    function = 2664841801,
    array = 2321067302,
    string = 398550328,
    number = 467038368,
    boolean = 1710517951,
    symbol = 4093333969,
    object = 3099987130,
    bigint = 2322048458,
    unknown = 2608177081,
    null = 1996966820,
    undefined = 2606869827,
    Reference = 1511734349
}
type UnproxyableValue<TValue, TKind extends number | ProxyValueKinds = any> = TValue extends ProxyInstruction ? TValue : ProxyInstruction<TKind, TValue>;
type ProxyReferenceInstruction = ProxyInstruction<ProxyValueKinds.Reference, string>;
type ProxyablePrimitiveUnknown = UnproxyableValue<unknown>;
declare enum ProxyInstructionKinds {
    local = 2621662984,
    get = 1410115415,
    set = 3324446467,
    apply = 616319547,
    construct = 1086361970,
    execute = 2686336408,
    throw = 2054714927,
    return = 2246981567,
    next = 1555467752,
    release = 439041101
}
type ProxyLocalInstruction = ProxyInstruction<ProxyInstructionKinds.local, ProxyablePrimitiveUnknown>;
type ProxyGetInstruction = ProxyInstruction<ProxyInstructionKinds.get, [
    string
]>;
type ProxySetInstruction = ProxyInstruction<ProxyInstructionKinds.set, [
    string,
    unknown
]>;
type ProxyApplyInstruction = ProxyInstruction<ProxyInstructionKinds.apply, unknown[]>;
type ProxyConstructInstruction = ProxyInstruction<ProxyInstructionKinds.construct, unknown[]>;
type ProxyReleaseInstruction = ProxyInstruction<ProxyInstructionKinds.release, [
    string
]>;
type ProxyError = {
    message: string;
    cause?: ProxyError;
} & Record<string, unknown>;
type ProxyThrowInstruction = ProxyInstruction<ProxyInstructionKinds.throw, ProxyError>;
type ProxyReturnInstruction = ProxyInstruction<ProxyInstructionKinds.return, ProxyablePrimitiveUnknown>;
type ProxyNextInstruction = ProxyInstruction<ProxyInstructionKinds.next>;
type ProxyExecuteInstruction = ProxyInstruction<ProxyInstructionKinds.execute, ProxyInstructions[]>;
type ProxyInstructionUnknown = ProxyInstruction<ProxyInstructionKinds | number, unknown | undefined>;
type ProxyInstructions = ProxyExecuteInstruction | ProxyThrowInstruction | ProxyReturnInstruction | ProxyNextInstruction | ProxyGetInstruction | ProxySetInstruction | ProxyApplyInstruction | ProxyConstructInstruction | ProxyReferenceInstruction | ProxyApplyInstruction | ProxyConstructInstruction | ProxyReferenceInstruction | ProxyLocalInstruction | ProxyReleaseInstruction;
type ProxyInstructionData<TKind extends ProxyInstructionKinds | number> = TKind extends ProxyInstructionKinds ? Extract<ProxyInstructions, {
    kind: TKind;
}>["data"] : unknown;
type InferProxyInstruction<TKind extends number | ProxyInstructionKinds | undefined> = TKind extends ProxyInstructionKinds | number ? ProxyInstruction<TKind, ProxyInstructionData<TKind>> : ProxyInstructionUnknown;
type ProxyableInstructionHandler<TObject extends object> = {
    [TKind in ProxyInstructionKinds]?: (data: ProxyInstructionData<TKind>, stack?: ProxyInstructions[], target?: TObject) => Promise<ProxyableResults<unknown>>;
} & {
    eval: (instruction: ProxyInstructionUnknown, stack?: ProxyInstructions[]) => Promise<ProxyableResults<UnproxyableValue<unknown> | ProxyableImport<object> | ProxyReturnInstruction | ProxyThrowInstruction>>;
};
type ProxyableHandler<TObject extends object> = ProxyableInstructionHandler<TObject> & {
    stream: Session;
    decode: ProxyInstructionDecoder["decode"];
    encode: ProxyInstructionEncoder["encode"];
} & ProxyHandler<TObject>;
type ProxyableHandlerUnknown = ProxyableHandler<object>;
type ProxyInstructionEncoder = {
    encode: (data: unknown) => Uint8Array;
};
type ProxyableResults<TValue> = [ProxyError] | [null, TValue];
type ProxyableInstructionResults<TKind extends ProxyInstructionKinds | number | undefined> = ProxyableResults<InferProxyInstruction<TKind>>;
type ProxyInstructionDecoder = {
    [TKind in ProxyInstructionKinds]: (data: ProxyInstructionUnknown) => ProxyableInstructionResults<TKind>;
} & {
    [TKind in number]: (data: ProxyInstructionUnknown) => ProxyableInstructionResults<TKind>;
} & {
    decode: <TKind extends Array<number | ProxyInstructionKinds | undefined>>(data: ArrayLike<number> | BufferSource, kind?: TKind) => ProxyableInstructionResults<TKind[number]>;
};
type ProxyableExport<TObject extends object> = TObject & {
    [ProxyableSymbol.id]: string;
    [ProxyableSymbol.handler]: ProxyableHandler<TObject>;
};
type ProxyableImport<TObject extends object> = ((TObject extends {
    new (...args: any[]): any;
} ? {
    new (...args: unknown[]): Promise<ProxyableImport<InstanceType<TObject>>>;
} : Promise<TObject>) & (TObject extends object ? {
    [TKey in keyof TObject]: TObject[TKey] extends (...args: any[]) => any ? (...args: Parameters<TObject[TKey]>) => Promise<ProxyableImport<Awaited<ReturnType<TObject[TKey]>>>> : Promise<ProxyableImport<TObject[TKey] extends object ? TObject[TKey] : never>> | ProxyableImport<TObject[TKey] extends object ? TObject[TKey] : never>;
} : TObject)) & {
    [ProxyableSymbol.id]: string;
    [ProxyableSymbol.handler]: ProxyableHandlerUnknown;
};

declare class Proxyable {
    static exports: Record<string, unknown>;
    static imports: Record<string, unknown>;
    static export<TObject extends object>({ object, stream, handler, schema, }: {
        object: TObject;
        stream?: Duplex;
        handler?: ProxyableHandler<TObject>;
        schema?: unknown;
    }): ProxyableExport<TObject>;
    static import<TObject extends object>({ stream, schema, }: {
        stream: Duplex;
        handler?: ProxyableHandler<TObject>;
        schema?: unknown;
    }): ProxyableImport<TObject>;
}

export { Proxyable };
