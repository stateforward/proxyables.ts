const path = require("path");

module.exports = {
  name: "threads",
  async setup({ payloadBytes }) {
    const payload = "x".repeat(payloadBytes);
    const threads = await import("threads");
    const workerPath = path.join("..", "workers", "threads_worker.js");
    const worker = await threads.spawn(new threads.Worker(workerPath));
    return { worker, payload, Thread: threads.Thread };
  },
  async teardown(ctx) {
    if (ctx?.worker && ctx?.Thread) {
      await ctx.Thread.terminate(ctx.worker);
    }
  },
  scenarios: {
    async callNoArgs(ctx) {
      await ctx.worker.ping();
    },
    async callSmallArgs(ctx) {
      await ctx.worker.sum(2, 3);
    },
    async callLargePayload(ctx) {
      await ctx.worker.echoLength(ctx.payload);
    },
    async callbackRoundtrip(ctx) {
      await ctx.worker.withCallback("hi");
    },
  },
};
