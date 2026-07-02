import { TransformStream } from "node:stream/web";
import type { ClientOptions, ServerOptions } from "@stateforward/yamux.ts";

export function createTransportPair(): {
  client: ClientOptions;
  server: ServerOptions;
} {
  const clientToServer = new TransformStream<Uint8Array, Uint8Array>();
  const serverToClient = new TransformStream<Uint8Array, Uint8Array>();

  return {
    client: {
      readable: serverToClient.readable,
      writable: clientToServer.writable,
    },
    server: {
      readable: clientToServer.readable,
      writable: serverToClient.writable,
    },
  };
}
