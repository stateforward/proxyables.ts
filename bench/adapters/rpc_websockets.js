const net = require("net");
const { Client, Server } = require("rpc-websockets");

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForEvent(emitter, event) {
  return new Promise((resolve, reject) => {
    emitter.once(event, resolve);
    emitter.once("error", reject);
  });
}

module.exports = {
  name: "rpc-websockets",
  async setup({ payloadBytes }) {
    const payload = "x".repeat(payloadBytes);
    const port = await getFreePort();
    const server = new Server({ port, host: "127.0.0.1" });
    await waitForEvent(server, "listening");

    server.register("ping", () => 1);
    server.register("sum", ([a, b]) => a + b);
    server.register("echoLength", ([input]) => input.length);
    server.register("withCallback", () => "hi");

    const client = new Client(`ws://127.0.0.1:${port}`);
    await waitForEvent(client, "open");

    return { client, server, payload };
  },
  async teardown(ctx) {
    try {
      if (ctx?.client) ctx.client.close();
    } catch {}
    if (ctx?.server) {
      await ctx.server.close();
    }
  },
  scenarios: {
    async callNoArgs(ctx) {
      await ctx.client.call("ping");
    },
    async callSmallArgs(ctx) {
      await ctx.client.call("sum", [2, 3]);
    },
    async callLargePayload(ctx) {
      await ctx.client.call("echoLength", [ctx.payload]);
    },
    async callbackRoundtrip(ctx) {
      await ctx.client.call("withCallback");
    },
  },
};
