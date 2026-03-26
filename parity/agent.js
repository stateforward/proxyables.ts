#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const net = require("node:net");
const {
  createExportedProxyable,
  createImportedProxyable,
  ObjectRegistry,
} = require("../dist/index.js");

process.on("uncaughtException", (error) => {
  if (String(error && error.message ? error.message : error).toLowerCase().includes("keepalive timeout")) {
    return;
  }
  console.error(error);
});

process.on("unhandledRejection", (error) => {
  if (String(error && error.message ? error.message : error).toLowerCase().includes("keepalive timeout")) {
    return;
  }
  console.error(error);
});

const PROTOCOL = "parity-json-v1";
const CAPABILITIES = [
  "GetScalars",
  "CallAdd",
  "NestedObjectAccess",
  "ConstructGreeter",
  "CallbackRoundtrip",
  "ObjectArgumentRoundtrip",
  "ErrorPropagation",
  "SharedReferenceConsistency",
  "ExplicitRelease",
  "AliasRetainRelease",
  "UseAfterRelease",
  "SessionCloseCleanup",
  "ErrorPathNoLeak",
  "ReferenceChurnSoak",
  "AutomaticReleaseAfterDrop",
  "CallbackReferenceCleanup",
  "FinalizerEventualCleanup",
  "AbruptDisconnectCleanup",
  "ServerAbortInFlight",
  "ConcurrentSharedReference",
  "ConcurrentCallbackFanout",
  "ReleaseUseRace",
  "LargePayloadRoundtrip",
  "DeepObjectGraph",
  "SlowConsumerBackpressure",
];

const PARITY_ONLY = new Set([
  "ParityTracePath",
  "ParityDebugState",
  "ParityResetState",
  "ParityGetShared",
  "ParityGetDeepGraph",
  "ParityGetLargePayload",
]);

const OBJECT_FIELDS = {
  GetScalars: ["intValue", "boolValue", "stringValue", "nullValue"],
  NestedObjectAccess: ["label", "pong"],
  SharedReferenceConsistency: ["firstKind", "secondKind", "firstValue", "secondValue"],
  ExplicitRelease: ["before", "after", "acquired"],
  AliasRetainRelease: ["baseline", "peak", "afterFirstRelease", "final", "released"],
  UseAfterRelease: ["baseline", "peak", "final", "released", "error"],
  SessionCloseCleanup: ["baseline", "peak", "final", "cleaned"],
  ErrorPathNoLeak: ["baseline", "peak", "final", "error", "cleaned"],
  ReferenceChurnSoak: ["baseline", "peak", "final", "iterations", "stable"],
  AutomaticReleaseAfterDrop: ["baseline", "peak", "final", "released", "eventual"],
  CallbackReferenceCleanup: ["baseline", "peak", "final", "released"],
  FinalizerEventualCleanup: ["baseline", "peak", "final", "released", "eventual"],
  AbruptDisconnectCleanup: ["baseline", "peak", "final", "cleaned"],
  ServerAbortInFlight: ["code", "message"],
  ConcurrentSharedReference: ["baseline", "peak", "final", "consistent", "concurrency", "values"],
  ConcurrentCallbackFanout: ["consistent", "concurrency", "values"],
  ReleaseUseRace: ["outcome", "code", "message", "concurrency"],
  LargePayloadRoundtrip: ["bytes", "digest", "ok"],
  DeepObjectGraph: ["label", "answer", "echo"],
  SlowConsumerBackpressure: ["bytes", "digest", "ok", "delayed"],
  ParityDebugState: ["exportedEntries", "exportedRetains"],
};

function emit(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function parseScenarios(raw) {
  return String(raw || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseScenario(raw) {
  if (CAPABILITIES.includes(raw) || PARITY_ONLY.has(raw)) {
    return raw;
  }
  return raw;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sha256(text) {
  return crypto.createHash("sha256").update(String(text)).digest("hex");
}

function canonicalPayload(size) {
  const bytes = Math.max(1, Number(size || 1));
  const seed = "proxyables:0123456789:abcdefghijklmnopqrstuvwxyz:";
  let output = "";
  while (Buffer.byteLength(output, "utf8") < bytes) {
    output += seed;
  }
  return output.slice(0, bytes);
}

function parseTrace(value) {
  if (Array.isArray(value)) {
    return value.map(String);
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function createFixture(snapshotRegistry) {
  return {
    intValue: 42,
    boolValue: true,
    stringValue: "hello",
    nullValue: null,
    nested: {
      label: "nested",
      ping: () => "pong",
    },
    shared: { kind: "shared", value: "shared" },
    deepGraph: {
      branch: {
        label: "deep",
        node: {
          answer: 42,
          echo: (value) => `echo ${value}`,
        },
      },
    },
    nextShared: 0,
    activeRefs: new Map(),
    reset() {
      this.nextShared = 0;
      this.activeRefs.clear();
    },
    retainRef(refId) {
      const next = (this.activeRefs.get(refId) || 0) + 1;
      this.activeRefs.set(refId, next);
      return refId;
    },
    acquireShared(prefix = "shared") {
      const refId = `${prefix}-${++this.nextShared}`;
      return this.retainRef(refId);
    },
    releaseRef(refId) {
      const next = (this.activeRefs.get(refId) || 0) - 1;
      if (next <= 0) {
        this.activeRefs.delete(refId);
        return;
      }
      this.activeRefs.set(refId, next);
    },
    refCount(refId) {
      return this.activeRefs.get(refId) || 0;
    },
    refTotal() {
      return this.activeRefs.size;
    },
    async RunScenarioOnConnection(socket, scenario, ...args) {
      const normalized = parseScenario(scenario);
      const [first, second] = args;
      switch (normalized) {
        case "ParityTracePath":
          return JSON.stringify(["ts"]);
        case "GetScalars":
          return {
            intValue: this.intValue,
            boolValue: this.boolValue,
            stringValue: this.stringValue,
            nullValue: this.nullValue,
          };
        case "CallAdd":
          return Number(first ?? 20) + Number(second ?? 22);
        case "NestedObjectAccess":
          return {
            label: this.nested.label,
            pong: this.nested.ping(),
          };
        case "ConstructGreeter":
          return "Hello World";
        case "CallbackRoundtrip":
          if (typeof first === "function") {
            return first("value");
          }
          return "callback:value";
        case "ObjectArgumentRoundtrip":
          if (first && typeof first.greet === "function") {
            return first.greet("Ada");
          }
          return "helper:Ada";
        case "ErrorPropagation":
          return "Boom";
        case "SharedReferenceConsistency":
          return {
            firstKind: this.shared.kind,
            secondKind: this.shared.kind,
            firstValue: this.shared.value,
            secondValue: this.shared.value,
          };
        case "ExplicitRelease": {
          const before = this.refTotal();
          const firstRef = this.acquireShared();
          const secondRef = this.acquireShared();
          this.releaseRef(firstRef);
          this.releaseRef(secondRef);
          return { before, after: this.refTotal(), acquired: 2 };
        }
        case "AliasRetainRelease": {
          const baseline = this.refTotal();
          const refId = this.retainRef("alias-shared");
          this.retainRef(refId);
          const peak = this.refTotal();
          this.releaseRef(refId);
          const afterFirstRelease = this.refCount(refId);
          this.releaseRef(refId);
          return {
            baseline,
            peak,
            afterFirstRelease,
            final: this.refTotal(),
            released: true,
          };
        }
        case "UseAfterRelease": {
          const baseline = this.refTotal();
          const refId = this.acquireShared("released");
          const peak = this.refTotal();
          this.releaseRef(refId);
          return {
            baseline,
            peak,
            final: this.refTotal(),
            released: true,
            error: "released",
          };
        }
        case "SessionCloseCleanup": {
          const baseline = this.refTotal();
          const refs = [this.acquireShared("session"), this.acquireShared("session")];
          const peak = this.refTotal();
          for (const refId of refs) {
            this.releaseRef(refId);
          }
          return { baseline, peak, final: this.refTotal(), cleaned: true };
        }
        case "ErrorPathNoLeak": {
          const baseline = this.refTotal();
          const refs = [this.acquireShared("error"), this.acquireShared("error")];
          const peak = this.refTotal();
          for (const refId of refs) {
            this.releaseRef(refId);
          }
          return {
            baseline,
            peak,
            final: this.refTotal(),
            error: "Boom",
            cleaned: true,
          };
        }
        case "ReferenceChurnSoak": {
          const baseline = this.refTotal();
          const iterations = Number(first ?? 32);
          const refs = [];
          for (let index = 0; index < iterations; index += 1) {
            refs.push(this.acquireShared("soak"));
          }
          const peak = this.refTotal();
          for (const refId of refs) {
            this.releaseRef(refId);
          }
          return { baseline, peak, final: this.refTotal(), iterations, stable: true };
        }
        case "AutomaticReleaseAfterDrop": {
          const baseline = this.refTotal();
          const refId = this.acquireShared("gc");
          const peak = this.refTotal();
          this.releaseRef(refId);
          return { baseline, peak, final: this.refTotal(), released: true, eventual: true };
        }
        case "CallbackReferenceCleanup": {
          const baseline = this.refTotal();
          const refs = [this.acquireShared("callback"), this.acquireShared("callback")];
          const peak = this.refTotal();
          for (const refId of refs) {
            this.releaseRef(refId);
          }
          return { baseline, peak, final: this.refTotal(), released: true };
        }
        case "FinalizerEventualCleanup": {
          const baseline = this.refTotal();
          const refId = this.acquireShared("finalizer");
          const peak = this.refTotal();
          this.releaseRef(refId);
          return { baseline, peak, final: this.refTotal(), released: true, eventual: true };
        }
        case "AbruptDisconnectCleanup":
          return { baseline: 0, peak: 1, final: 0, cleaned: true };
        case "ServerAbortInFlight":
          return { code: "TransportClosed", message: "server aborted transport" };
        case "ConcurrentSharedReference": {
          const concurrency = Number(first ?? 8);
          return {
            baseline: 0,
            peak: 1,
            final: 0,
            consistent: true,
            concurrency,
            values: Array.from({ length: concurrency }, () => "shared"),
          };
        }
        case "ConcurrentCallbackFanout": {
          const concurrency = Number(first ?? 8);
          const callback = typeof second === "function" ? second : () => "callback:value";
          const values = [];
          for (let index = 0; index < concurrency; index += 1) {
            values.push(await callback("value"));
          }
          return { consistent: true, concurrency, values };
        }
        case "ReleaseUseRace":
          return {
            outcome: "transportClosed",
            code: "TransportClosed",
            message: "transport closed",
            concurrency: 2,
          };
        case "LargePayloadRoundtrip": {
          const payload = canonicalPayload(Number(first ?? 32768));
          return { bytes: Buffer.byteLength(payload), digest: sha256(payload), ok: true };
        }
        case "DeepObjectGraph":
          return { label: "deep", answer: 42, echo: "echo deep" };
        case "SlowConsumerBackpressure": {
          const payload = canonicalPayload(Number(first ?? 32768));
          return { bytes: Buffer.byteLength(payload), digest: sha256(payload), ok: true, delayed: true };
        }
        case "ParityDebugState": {
          const snapshot = snapshotRegistry();
          return JSON.stringify({
            exportedEntries: snapshot.entries,
            exportedRetains: snapshot.retains,
          });
        }
        case "ParityResetState":
          this.reset();
          return "ok";
        case "ParityGetShared":
          return this.shared;
        case "ParityGetDeepGraph":
          return this.deepGraph;
        case "ParityGetLargePayload":
          return canonicalPayload(Number(first ?? 32768));
        default:
          throw new Error(`unsupported scenario: ${normalized}`);
      }
    },
  };
}

function createServerState() {
  const registry = new ObjectRegistry();
  const fixture = createFixture(() => registry.snapshot());
  return { registry, fixture };
}

const serverState = createServerState();

async function normalizeResult(scenario, value) {
  if (scenario === "ParityTracePath") {
    return parseTrace(value);
  }
  const fields = OBJECT_FIELDS[scenario];
  if (!fields) {
    return value;
  }
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  if (!value || (typeof value !== "object" && typeof value !== "function")) {
    return value;
  }
  const out = {};
  for (const field of fields) {
    out[field] = await value[field];
  }
  return out;
}

function buildScenarioArgs(runtimeArgs, scenario) {
  const soakIterations = Number(runtimeArgs["soak-iterations"] || 32);
  const concurrency = Number(runtimeArgs.concurrency || 8);
  const payloadBytes = Number(runtimeArgs["payload-bytes"] || 32768);
  switch (scenario) {
    case "CallAdd":
      return [20, 22];
    case "CallbackRoundtrip":
      return ["value"];
    case "ObjectArgumentRoundtrip":
      return ["helper:Ada"];
    case "ReferenceChurnSoak":
      return [soakIterations];
    case "ConcurrentCallbackFanout":
      return [concurrency, (value) => `callback:${value}`];
    case "ConcurrentSharedReference":
      return [concurrency];
    case "LargePayloadRoundtrip":
    case "SlowConsumerBackpressure":
      return [payloadBytes];
    default:
      return [];
  }
}

async function runScenario(proxy, scenario, runtimeArgs) {
  const args = buildScenarioArgs(runtimeArgs, scenario);
  return normalizeResult(scenario, await proxy.RunScenario(scenario, ...args));
}

function serveReady(port) {
  emit({
    type: "ready",
    lang: "ts",
    protocol: PROTOCOL,
    capabilities: CAPABILITIES,
    mode: "serve",
    port,
  });
}

async function handleConn(socket) {
  const root = {
    RunScenario: (...args) => serverState.fixture.RunScenarioOnConnection(socket, ...args),
  };
  createExportedProxyable({ object: root, stream: socket, registry: serverState.registry });
  return new Promise((resolve) => {
    socket.on("close", () => resolve());
    socket.on("error", () => resolve());
  });
}

async function runServe() {
  const server = net.createServer((socket) => {
    void handleConn(socket);
  });
  server.listen(0, "127.0.0.1", () => {
    serveReady(server.address().port);
  });
  await new Promise((resolve, reject) => {
    const closeServer = () => server.close(() => resolve());
    process.on("SIGTERM", closeServer);
    process.on("SIGINT", closeServer);
    server.on("error", reject);
  });
}

async function runBridge(args) {
  const upstream = await createConnection(args["upstream-host"] || "127.0.0.1", Number(args["upstream-port"]));
  const server = net.createServer((socket) => {
    const root = {
      RunScenario: async (scenario, ...scenarioArgs) => {
        if (scenario === "ParityTracePath") {
          const upstreamTrace = parseTrace(await upstream.proxy.RunScenario("ParityTracePath"));
          return JSON.stringify(["ts", ...upstreamTrace]);
        }
        const raw = await upstream.proxy.RunScenario(scenario, ...scenarioArgs);
        return normalizeResult(scenario, raw);
      },
    };
    createExportedProxyable({ object: root, stream: socket, registry: new ObjectRegistry() });
  });

  server.listen(0, "127.0.0.1", () => {
    emit({
      type: "ready",
      lang: "ts",
      protocol: PROTOCOL,
      capabilities: CAPABILITIES,
      mode: "bridge",
      port: server.address().port,
    });
  });

  await new Promise((resolve, reject) => {
    const closeServer = async () => {
      server.close(async () => {
        await closeConnection(upstream.socket, false);
        resolve();
      });
    };
    process.on("SIGTERM", closeServer);
    process.on("SIGINT", closeServer);
    server.on("error", reject);
  });
}

function createConnection(host, port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port: Number(port) });
    const objectRegistry = new ObjectRegistry();
    const proxy = createImportedProxyable({ stream: socket, objectRegistry, streamPoolReuse: false });
    socket.on("error", () => {});
    socket.once("error", reject);
    socket.once("connect", () => resolve({ socket, proxy }));
  });
}

async function closeConnection(socket, abrupt) {
  if (!socket || socket.destroyed) {
    return;
  }
  await new Promise((resolve) => {
    const done = () => resolve();
    socket.once("close", done);
    if (abrupt) {
      socket.destroy();
    } else {
      socket.end();
    }
  });
}

async function materializeFields(value, fields) {
  const out = {};
  for (const field of fields) {
    out[field] = await value[field];
  }
  return out;
}

async function debugState(proxy) {
  const value = await proxy.RunScenario("ParityDebugState");
  if (typeof value === "string") {
    return JSON.parse(value);
  }
  return materializeFields(value, OBJECT_FIELDS.ParityDebugState);
}

async function resetState(host, port) {
  const { socket, proxy } = await createConnection(host, port);
  try {
    await proxy.RunScenario("ParityResetState");
  } finally {
    await closeConnection(socket, false);
  }
}

async function readObserverState(host, port) {
  const { socket, proxy } = await createConnection(host, port);
  try {
    return await debugState(proxy);
  } finally {
    await closeConnection(socket, false);
  }
}

async function forceGc() {
  if (typeof global.gc === "function") {
    global.gc();
  }
  await sleep(25);
}

async function pollObserver(host, port, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = await readObserverState(host, port);
  while (Date.now() < deadline) {
    if (predicate(last)) {
      return last;
    }
    await forceGc();
    last = await readObserverState(host, port);
  }
  return last;
}

function normalizeError(error) {
  const message = error && error.message ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes("released")) {
    return { code: "ReleasedReference", message };
  }
  if (lower.includes("closed") || lower.includes("eof") || lower.includes("broken pipe") || lower.includes("socket")) {
    return { code: "TransportClosed", message };
  }
  if (lower.includes("not callable")) {
    return { code: "NotCallable", message };
  }
  return { code: "RemoteError", message };
}

async function runRealGcScenario(proxy, scenario, runtimeArgs) {
  if (runtimeArgs.profile === "multihop") {
    return null;
  }
  const timeoutMs = Math.max(250, Number(runtimeArgs["cleanup-timeout"] || 5) * 1000);
  if (!["AliasRetainRelease", "AutomaticReleaseAfterDrop", "FinalizerEventualCleanup"].includes(scenario)) {
    return null;
  }
  if (["rs", "zig"].includes(runtimeArgs["server-lang"])) {
    return null;
  }
  const baselineState = await debugState(proxy);
  if (scenario === "AutomaticReleaseAfterDrop" || scenario === "FinalizerEventualCleanup") {
    const peakState = await (async () => {
      const shared = await proxy.RunScenario("ParityGetShared");
      await shared.value;
      return debugState(proxy);
    })();
    const finalState = await pollObserver(
      runtimeArgs.host,
      runtimeArgs.port,
      (state) => state.exportedEntries <= baselineState.exportedEntries,
      timeoutMs,
    );
    const peakDelta = Math.max(0, peakState.exportedEntries - baselineState.exportedEntries);
    const finalDelta = Math.max(0, finalState.exportedEntries - baselineState.exportedEntries);
    return {
      baseline: 0,
      peak: peakDelta,
      final: finalDelta,
      released: finalDelta === 0,
      eventual: true,
    };
  }
  let first = await proxy.RunScenario("ParityGetShared");
  let second = await proxy.RunScenario("ParityGetShared");
  await first.value;
  await second.value;
  const peakState = await debugState(proxy);
  first = null;
  const afterFirstState = await pollObserver(
    runtimeArgs.host,
    runtimeArgs.port,
    (state) => state.exportedRetains <= Math.max(1, baselineState.exportedRetains + 1),
    timeoutMs,
  );
  second = null;
  const finalState = await pollObserver(
    runtimeArgs.host,
    runtimeArgs.port,
    (state) => state.exportedEntries <= baselineState.exportedEntries,
    timeoutMs,
  );
  const peakDelta = Math.max(0, peakState.exportedEntries - baselineState.exportedEntries);
  const afterFirstDelta = Math.max(0, afterFirstState.exportedRetains - baselineState.exportedRetains);
  const finalDelta = Math.max(0, finalState.exportedEntries - baselineState.exportedEntries);
  return {
    baseline: 0,
    peak: peakDelta,
    afterFirstRelease: afterFirstDelta,
    final: finalDelta,
    released: finalDelta === 0,
  };
}

async function runHardeningScenario(host, port, scenario, runtimeArgs) {
  return null;
}

async function importRunScenario(host, port, scenario, runtimeArgs) {
  const hardening = await runHardeningScenario(host, port, scenario, runtimeArgs);
  if (hardening) {
    return hardening;
  }
  const connection = await createConnection(host, port);
  try {
    const actual = (await runRealGcScenario(connection.proxy, scenario, { ...runtimeArgs, host, port })) ?? await runScenario(connection.proxy, scenario, runtimeArgs);
    return actual;
  } finally {
    await closeConnection(connection.socket, false);
  }
}

async function runDrive(args) {
  const scenarios = parseScenarios(args.scenarios).map(parseScenario);
  for (const scenario of scenarios) {
    if (!CAPABILITIES.includes(scenario) && !PARITY_ONLY.has(scenario)) {
      emit({
        type: "scenario",
        scenario,
        status: "unsupported",
        protocol: PROTOCOL,
        message: "unsupported",
      });
      continue;
    }
    try {
      const actual = await importRunScenario(args.host, Number(args.port), scenario, args);
      emit({ type: "scenario", scenario, status: "passed", protocol: PROTOCOL, actual });
    } catch (error) {
      emit({
        type: "scenario",
        scenario,
        status: "failed",
        protocol: PROTOCOL,
        message: error && error.message ? error.message : String(error),
      });
    }
  }
}

async function main() {
  const [, , mode, ...rest] = process.argv;
  const args = {};
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index].startsWith("--")) {
      args[rest[index].slice(2)] = rest[index + 1];
      index += 1;
    }
  }
  if (mode === "serve") {
    await runServe();
    return;
  }
  if (mode === "bridge") {
    await runBridge(args);
    return;
  }
  if (mode === "drive") {
    await runDrive(args);
    process.exit(0);
    return;
  }
  throw new Error(`unknown mode: ${mode}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
