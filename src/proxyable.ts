import { ProxyableHandler, ProxyableExport } from "./types";
import { createExportedProxyable } from "./exported";
import { ProxyableSymbol } from "./symbol";
import { createImportedProxyable } from "./imported";
import type {
  ProxyableClientTransport,
  ProxyableServerTransport,
} from "./transport";

export class Proxyable {
  static exports: Record<string, unknown> = {};
  static imports: Record<string, unknown> = {};

  static Export<TObject extends object>({
    object,
    transport,
    handler,
    schema,
  }: {
    object: TObject;
    transport: ProxyableServerTransport;
    handler?: ProxyableHandler<TObject>;
    schema?: unknown;
  }): ProxyableExport<TObject> {
    const proxy = createExportedProxyable<TObject>({ transport, object, handler });
    Proxyable.exports[proxy[ProxyableSymbol.id]] = proxy;
    return proxy;
  }

  static ImportFrom<TObject extends object>({
    transport,
    schema,
  }: {
    transport: ProxyableClientTransport;
    handler?: ProxyableHandler<TObject>;
    schema?: unknown;
  }) {
    const proxy = createImportedProxyable<TObject>({ transport });
    Proxyable.imports[proxy[ProxyableSymbol.id]] = proxy;
    return proxy;
  }
}
