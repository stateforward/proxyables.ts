const { TransformStream } = require("node:stream/web");

function createTransportPair() {
  const clientToServer = new TransformStream();
  const serverToClient = new TransformStream();

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

module.exports = {
  name: "proxyables",
  muteOutput: true,
  async setup({ payloadBytes }) {
    const { Proxyable } = await import("../../dist/index.mjs");
    const payload = "x".repeat(payloadBytes);
    const object = {
      ping() {
        return 1;
      },
      sum(a, b) {
        return a + b;
      },
      echoLength(input) {
        return input.length;
      },
      withCallback(cb) {
        return cb("hi");
      },
    };
    const transport = createTransportPair();
    Proxyable.Export({ object, transport: transport.server });
    const remote = Proxyable.ImportFrom({ transport: transport.client });
    return { remote, payload };
  },
  async teardown() {},
  scenarios: {
    async callNoArgs(ctx) {
      await ctx.remote.ping();
    },
    async callSmallArgs(ctx) {
      await ctx.remote.sum(2, 3);
    },
    async callLargePayload(ctx) {
      await ctx.remote.echoLength(ctx.payload);
    },
    async callbackRoundtrip(ctx) {
      await ctx.remote.withCallback((value) => value);
    },
  },
};
