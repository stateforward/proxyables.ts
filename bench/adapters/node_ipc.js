function getDefault(moduleValue) {
  return moduleValue && moduleValue.default ? moduleValue.default : moduleValue;
}

function createIPCInstance() {
  const ipcModule = require("@node-ipc/node-ipc");
  const ipcDefault = getDefault(ipcModule);
  const IPCConstructor =
    ipcDefault?.IPC || ipcModule?.IPC || ipcModule?.IPCModule;
  if (IPCConstructor) {
    return new IPCConstructor();
  }
  return ipcDefault;
}

function waitForEvent(emitter, event, timeoutMs = 250) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, timeoutMs);
    const cleanup = () => clearTimeout(timer);
    emitter.once(event, () => {
      cleanup();
      resolve();
    });
    emitter.once("error", (err) => {
      cleanup();
      reject(err);
    });
  });
}

module.exports = {
  name: "node-ipc",
  async setup({ payloadBytes }) {
    const payload = "x".repeat(payloadBytes);
    const serverId = `proxyables-bench-${process.pid}-${Date.now()}`;

    const serverIpc = createIPCInstance();
    serverIpc.config.id = serverId;
    serverIpc.config.silent = true;
    serverIpc.config.retry = 500;

    const methods = {
      ping() {
        return 1;
      },
      sum([a, b]) {
        return a + b;
      },
      echoLength([input]) {
        return input.length;
      },
      withCallback() {
        return "hi";
      },
    };

    serverIpc.serve(() => {
      serverIpc.server.on("bench:request", (data, socket) => {
        const { id, method, params } = data || {};
        let result;
        let error;
        try {
          const fn = methods[method];
          result = fn ? fn(params || []) : undefined;
        } catch (err) {
          error = err?.message || String(err);
        }
        serverIpc.server.emit(socket, "bench:response", { id, result, error });
      });
    });
    serverIpc.server.start();
    await waitForEvent(serverIpc.server, "start");

    const clientIpc = createIPCInstance();
    clientIpc.config.id = `${serverId}-client`;
    clientIpc.config.silent = true;
    clientIpc.config.retry = 500;

    await new Promise((resolve, reject) => {
      clientIpc.connectTo(serverId, () => {
        const client = clientIpc.of[serverId];
        if (!client) {
          reject(new Error("IPC client not available"));
          return;
        }
        client.once("connect", resolve);
        client.once("error", reject);
      });
    });

    const pending = new Map();
    clientIpc.of[serverId].on("bench:response", (data) => {
      const { id, result, error } = data || {};
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      if (error) entry.reject(new Error(error));
      else entry.resolve(result);
    });

    let nextId = 0;
    const call = (method, params = []) =>
      new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        clientIpc.of[serverId].emit("bench:request", { id, method, params });
      });

    return { call, serverIpc, clientIpc, serverId, payload };
  },
  async teardown(ctx) {
    try {
      if (ctx?.clientIpc && ctx?.serverId) {
        ctx.clientIpc.disconnect(ctx.serverId);
      }
    } catch {}
    try {
      if (ctx?.serverIpc) {
        ctx.serverIpc.server.stop();
      }
    } catch {}
  },
  scenarios: {
    async callNoArgs(ctx) {
      await ctx.call("ping");
    },
    async callSmallArgs(ctx) {
      await ctx.call("sum", [2, 3]);
    },
    async callLargePayload(ctx) {
      await ctx.call("echoLength", [ctx.payload]);
    },
    async callbackRoundtrip(ctx) {
      await ctx.call("withCallback");
    },
  },
};
