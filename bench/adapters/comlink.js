const path = require("path");
const { Worker } = require("worker_threads");

function getDefault(moduleValue) {
  return moduleValue && moduleValue.default ? moduleValue.default : moduleValue;
}

module.exports = {
  name: "comlink",
  async setup({ payloadBytes }) {
    const payload = "x".repeat(payloadBytes);
    const Comlink = getDefault(require("comlink/dist/umd/comlink.js"));
    const nodeEndpoint = getDefault(
      require("comlink/dist/umd/node-adapter")
    );
    const workerPath = path.join(__dirname, "../workers/comlink_worker.js");
    const worker = new Worker(workerPath);
    const remote = Comlink.wrap(nodeEndpoint(worker));
    return { remote, payload, worker, Comlink };
  },
  async teardown(ctx) {
    try {
      if (ctx?.remote && ctx?.Comlink?.releaseProxy) {
        ctx.remote[ctx.Comlink.releaseProxy]();
      }
    } catch {}
    if (ctx?.worker) {
      await ctx.worker.terminate();
    }
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
      await ctx.remote.withCallback(
        ctx.Comlink.proxy((value) => value)
      );
    },
  },
};
