const { parentPort } = require("worker_threads");

function getDefault(moduleValue) {
  return moduleValue && moduleValue.default ? moduleValue.default : moduleValue;
}

const Comlink = getDefault(require("comlink/dist/umd/comlink.js"));
const nodeEndpoint = getDefault(require("comlink/dist/umd/node-adapter"));

const api = {
  ping() {
    return 1;
  },
  sum(a, b) {
    return a + b;
  },
  echoLength(input) {
    return input.length;
  },
  async withCallback(cb) {
    return cb("hi");
  },
};

Comlink.expose(api, nodeEndpoint(parentPort));
