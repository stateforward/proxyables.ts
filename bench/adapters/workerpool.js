const path = require("path");
const workerpool = require("workerpool");

module.exports = {
  name: "workerpool",
  async setup({ payloadBytes }) {
    const payload = "x".repeat(payloadBytes);
    const workerPath = path.join(__dirname, "../workers/workerpool_worker.js");
    const pool = workerpool.pool(workerPath, { maxWorkers: 1 });
    const proxy = await pool.proxy();
    return { pool, proxy, payload };
  },
  async teardown(ctx) {
    if (ctx?.pool) {
      await ctx.pool.terminate(true);
    }
  },
  scenarios: {
    async callNoArgs(ctx) {
      await ctx.proxy.ping();
    },
    async callSmallArgs(ctx) {
      await ctx.proxy.sum(2, 3);
    },
    async callLargePayload(ctx) {
      await ctx.proxy.echoLength(ctx.payload);
    },
    async callbackRoundtrip(ctx) {
      await ctx.proxy.withCallback("hi");
    },
  },
};
