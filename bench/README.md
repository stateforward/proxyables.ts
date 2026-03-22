# Benchmarks

Lightweight benchmark harness for comparing adapters.

## Usage

Build first (bench uses `dist/`):

```
npm run build
node bench/bench.js --list
node bench/bench.js --adapter proxyables --iterations 1000 --warmup 100
node bench/bench.js --adapter local --only callNoArgs
node bench/bench.js --adapter proxyables --tag nightly
node bench/bench.js --adapter local --outDir bench/results
node bench/bench.js --all --tag nightly
```

## Adapters

- `local`: Baseline direct calls.
- `proxyables`: This library using in-process streams.
- `comlink`: Worker_threads + Comlink proxy.
- `threads`: Worker_threads via threads.js.
- `workerpool`: workerpool proxy over worker_threads.
- `rpc-websockets`: JSON-RPC over WebSockets.
- `node-ipc`: IPC over Unix sockets via @node-ipc/node-ipc.

Notes:
- `callbackRoundtrip` is a true callback for `proxyables` and `comlink`.
- For adapters that don't support function arguments, `callbackRoundtrip` is emulated with a simple RPC call.
 - Each run writes a JSON snapshot to `bench/results/` using an ISO timestamp in the filename.

You can add additional adapters in `bench/adapters/` with the same interface:

```js
module.exports = {
  name: "my-adapter",
  async setup(options) { return { /* context */ }; },
  async teardown(context) {},
  scenarios: {
    async callNoArgs(ctx) {},
    async callSmallArgs(ctx) {},
    async callLargePayload(ctx) {},
    async callbackRoundtrip(ctx) {},
  },
};
```
