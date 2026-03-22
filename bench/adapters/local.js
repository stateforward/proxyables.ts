module.exports = {
  name: "local",
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
    return { object, payload };
  },
  async teardown() {},
  scenarios: {
    async callNoArgs(ctx) {
      ctx.object.ping();
    },
    async callSmallArgs(ctx) {
      ctx.object.sum(2, 3);
    },
    async callLargePayload(ctx) {
      ctx.object.echoLength(ctx.payload);
    },
    async callbackRoundtrip(ctx) {
      ctx.object.withCallback((value) => value);
    },
  },
};
