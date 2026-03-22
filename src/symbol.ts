type ProxyableSymbolFunction = ((description: string | number) => symbol) & {
  readonly handler: unique symbol;
  readonly id: unique symbol;
  readonly kind: unique symbol;
  readonly schema: unique symbol;
};

export const ProxyableSymbol: ProxyableSymbolFunction = Object.defineProperties(
  (description: string | number): symbol => {
    return Symbol.for(description.toString());
  },
  {
    id: { value: Symbol("id") },
    handler: { value: Symbol("handler") },
    kind: { value: Symbol("kind") },
    schema: { value: Symbol("schema") },
  }
) as ProxyableSymbolFunction;
