import { ProxyableHandler, ProxyableExport } from "./types";
import { Client, Duplex, Server, Session } from "yamux-js/cjs";
import { createExportedProxyable } from "./exported";
import { ProxyableSymbol } from "./symbol";
import { createImportedProxyable } from "./imported";
import { logger as log } from "./logger";

export class Proxyable {
  static exports: Record<string, unknown> = {};
  static imports: Record<string, unknown> = {};

  static export<TObject extends object>({
    object,
    stream,
    handler,
    schema,
  }: {
    object: TObject;
    stream?: Duplex;
    handler?: ProxyableHandler<TObject>;
    schema?: unknown;
  }): ProxyableExport<TObject> {
    const proxy = createExportedProxyable<TObject>({ stream: stream as any, object, handler });
    Proxyable.exports[proxy[ProxyableSymbol.id]] = proxy;
    return proxy;
  }

  static importFrom<TObject extends object>({
    stream,
    schema,
  }: {
    stream: Duplex;
    handler?: ProxyableHandler<TObject>;
    schema?: unknown;
  }) {
    const proxy = createImportedProxyable<TObject>({ stream: stream as any });
    Proxyable.imports[proxy[ProxyableSymbol.id]] = proxy;
    return proxy;
  }
}
