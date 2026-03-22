import { Duplex, Transform } from 'readable-stream';
export { Duplex, PassThrough, Readable, Transform, Writable, finished, pipeline } from 'readable-stream';

interface Config {
    acceptBacklog?: number;
    enableKeepAlive?: boolean;
    keepAliveInterval?: number;
    connectionWriteTimeout?: number;
    maxStreamWindowSize?: number;
    logger?: typeof console.log;
}
declare const defaultConfig: {
    acceptBacklog: number;
    enableKeepAlive: boolean;
    keepAliveInterval: number;
    connectionWriteTimeout: number;
    maxStreamWindowSize: number;
    logger: (message?: any, ...optionalParams: any[]) => void;
};

declare class Header {
    version: number;
    type: number;
    flags: number;
    streamID: number;
    length: number;
    static LENGTH: number;
    constructor(version: number, type: number, flags: number, streamID: number, length: number);
    static parse(buffer: Uint8Array): Header;
    encode(): Uint8Array;
}

declare enum STREAM_STATES {
    Init = 0,
    SYNSent = 1,
    SYNReceived = 2,
    Established = 3,
    LocalClose = 4,
    RemoteClose = 5,
    Closed = 6,
    Reset = 7
}

declare class Stream extends Duplex {
    private recvWindow;
    private sendWindow;
    private id;
    private session;
    private state;
    private recvBuf?;
    private controlHdr?;
    constructor(session: Session, id: number, state: STREAM_STATES);
    ID(): number;
    _read(size: number): void;
    _write(chunk: any, encoding: string, cb: (error?: Error | null) => void): void;
    private concatUint8Arrays;
    private sendFlags;
    sendWindowUpdate(): void;
    updateRecvWindow(receivedSize: number): void;
    private sendClose;
    close(): void;
    forceClose(): void;
    private processFlags;
    incrSendWindow(hdr: Header): void;
}

type TransformCallback = (error?: Error | null, data?: any) => void;
declare class Session extends Transform {
    private localGoaway;
    private remoteGoAway;
    private nextStreamID;
    config: typeof defaultConfig;
    private pings;
    private pingID;
    private pingTimer?;
    private streams;
    private shutdown;
    protected onStream?: (duplex: Duplex) => void;
    private currentHeader?;
    constructor(client: boolean, config?: Config, onStream?: (duplex: Duplex) => void);
    _transform(chunk: any, encoding: BufferEncoding, cb: TransformCallback): void;
    private handleStreamMessage;
    closeStream(streamID: number): void;
    isClosed(): boolean;
    close(error?: Error): void;
    private incomingStream;
    private goAway;
    open(): Stream;
    private handlePing;
    private ping;
    private keepalive;
    send(header: Header, data?: ArrayBuffer): void;
    private handleGoAway;
}

declare class Client extends Session {
    constructor(config?: Config);
}

declare class Server extends Session {
    constructor(onStream: (duplex: Duplex) => void, config?: Config);
}

export { Client, type Config, Server, Session, Stream };
