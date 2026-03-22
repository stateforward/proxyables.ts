const { Duplex, PassThrough } = require("stream");
const { Proxyable } = require("../../dist");

function createDuplexPair() {
  const aToB = new PassThrough();
  const bToA = new PassThrough();

  const a = new Duplex({
    write(chunk, enc, cb) {
      aToB.write(chunk, enc, cb);
    },
    read() {},
  });
  const b = new Duplex({
    write(chunk, enc, cb) {
      bToA.write(chunk, enc, cb);
    },
    read() {},
  });

  aToB.on("data", (chunk) => b.push(chunk));
  bToA.on("data", (chunk) => a.push(chunk));
  aToB.on("end", () => b.push(null));
  bToA.on("end", () => a.push(null));

  return { a, b };
}

module.exports = {
  name: "proxyables",
  muteOutput: true,
  async setup({ payloadBytes }) {
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
    const { a: clientStream, b: serverStream } = createDuplexPair();
    Proxyable.export({ object, stream: serverStream });
    const remote = Proxyable.import({ stream: clientStream });
    return { remote, payload, clientStream, serverStream };
  },
  async teardown(ctx) {
    try {
      ctx?.clientStream?.destroy();
    } catch {}
    try {
      ctx?.serverStream?.destroy();
    } catch {}
  },
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
