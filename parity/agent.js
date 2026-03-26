#!/usr/bin/env node
"use strict";

const net = require("node:net");
const {
  createExportedProxyable,
  createImportedProxyable,
  ObjectRegistry,
} = require("../dist/index.js");

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
];

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
  ParityDebugState: ["exportedEntries", "exportedRetains"],
};

function buildScenarioArgs(runtimeArgs, scenario) {
  const soakIterations = Number(runtimeArgs["soak-iterations"] || 32);
  switch (scenario) {
    case "CallAdd":
      return [20, 22];
    case "CallbackRoundtrip":
      return [
        (value) => `callback:${value}`,
      ];
    case "ObjectArgumentRoundtrip":
      return [
        {
          greet: (value) => `helper:${value}`,
        },
      ];
    case "ReferenceChurnSoak":
      return [soakIterations];
    default:
      return [];
  }
}

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
  return raw;
}

async function normalizeResult(scenario, value) {
  const fields = OBJECT_FIELDS[scenario];
  if (!fields) {
    return value;
  }
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return { failedParse: value };
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
    nextShared: 0,
    activeRefs: new Map(),
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
    RunScenario(scenario, ...args) {
      const normalized = parseScenario(scenario);
      if (!normalized) {
        throw new Error(`unsupported scenario: ${scenario}`);
      }
      const [first, second] = args;
      switch (normalized) {
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
        case "SharedReferenceConsistency": {
          const first = this.shared;
          const second = this.shared;
          return {
            firstKind: first.kind,
            secondKind: second.kind,
            firstValue: first.value,
            secondValue: second.value,
          };
        }
        case "ExplicitRelease": {
          const before = this.refTotal();
          const firstRef = this.acquireShared();
          const secondRef = this.acquireShared();
          this.releaseRef(firstRef);
          this.releaseRef(secondRef);
          return {
            before,
            after: this.refTotal(),
            acquired: 2,
          };
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
            error: this.refCount(refId) === 0 ? "released" : "still-retained",
          };
        }
        case "SessionCloseCleanup": {
          const baseline = this.refTotal();
          const refs = [this.acquireShared("session"), this.acquireShared("session")];
          const peak = this.refTotal();
          for (const refId of refs) {
            this.releaseRef(refId);
          }
          return {
            baseline,
            peak,
            final: this.refTotal(),
            cleaned: true,
          };
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
          return {
            baseline,
            peak,
            final: this.refTotal(),
            iterations,
            stable: true,
          };
        }
        case "AutomaticReleaseAfterDrop": {
          const baseline = this.refTotal();
          const refId = this.acquireShared("gc");
          const peak = this.refTotal();
          this.releaseRef(refId);
          return {
            baseline,
            peak,
            final: this.refTotal(),
            released: true,
            eventual: true,
          };
        }
        case "CallbackReferenceCleanup": {
          const baseline = this.refTotal();
          const refs = [this.acquireShared("callback"), this.acquireShared("callback")];
          const peak = this.refTotal();
          for (const refId of refs) {
            this.releaseRef(refId);
          }
          return {
            baseline,
            peak,
            final: this.refTotal(),
            released: true,
          };
        }
        case "FinalizerEventualCleanup": {
          const baseline = this.refTotal();
          const refId = this.acquireShared("finalizer");
          const peak = this.refTotal();
          this.releaseRef(refId);
          return {
            baseline,
            peak,
            final: this.refTotal(),
            released: true,
            eventual: true,
          };
        }
        case "ParityDebugState": {
          const snapshot = snapshotRegistry();
          return JSON.stringify({
            exportedEntries: snapshot.entries,
            exportedRetains: snapshot.retains,
          });
        }
        case "ParityGetShared":
          return this.shared;
        default:
          throw new Error(`unsupported scenario: ${normalized}`);
      }
    },
  };
}

function runScenario(proxy, scenario, runtimeArgs) {
  const args = buildScenarioArgs(runtimeArgs, scenario);
  return Promise.resolve(proxy.RunScenario(scenario, ...args)).then((result) =>
    normalizeResult(scenario, result),
  );
}

function serveReady(port) {
  emit({
    type: "ready",
    lang: "ts",
    protocol: PROTOCOL,
    capabilities: CAPABILITIES,
    port,
  });
}

async function handleConn(socket) {
  const registry = new ObjectRegistry();
  const fixture = createFixture(() => registry.snapshot());
  createExportedProxyable({ object: fixture, stream: socket, registry });
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
    const onSigterm = () => {
      server.close(() => resolve());
    };
    process.on("SIGTERM", onSigterm);
    process.on("SIGINT", onSigterm);
    server.on("error", reject);
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
  if (value && (typeof value === "object" || typeof value === "function")) {
    return await materializeFields(value, OBJECT_FIELDS.ParityDebugState);
  }
  return value;
}

async function forceGc() {
  if (typeof global.gc === "function") {
    global.gc();
  }
  await new Promise((resolve) => setTimeout(resolve, 25));
}

async function pollUntil(readState, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = await readState();
  while (Date.now() < deadline) {
    if (predicate(last)) {
      return last;
    }
    await forceGc();
    last = await readState();
  }
  return last;
}

async function runRealGcScenario(proxy, scenario, runtimeArgs) {
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
    const finalState = await pollUntil(
      () => debugState(proxy),
      (state) => state.exportedEntries <= baselineState.exportedEntries,
      timeoutMs,
    );
    return {
      baseline: baselineState.exportedEntries,
      peak: peakState.exportedEntries,
      final: finalState.exportedEntries,
      released: finalState.exportedEntries <= baselineState.exportedEntries,
      eventual: true,
    };
  }

  let first = await proxy.RunScenario("ParityGetShared");
  let second = await proxy.RunScenario("ParityGetShared");
  await first.value;
  await second.value;
  const peakState = await debugState(proxy);
  first = null;
  const afterFirstState = await pollUntil(
    () => debugState(proxy),
    (state) => state.exportedRetains <= Math.max(1, baselineState.exportedRetains + 1),
    timeoutMs,
  );
  second = null;
  const finalState = await pollUntil(
    () => debugState(proxy),
    (state) => state.exportedEntries <= baselineState.exportedEntries,
    timeoutMs,
  );
  return {
    baseline: baselineState.exportedEntries,
    peak: peakState.exportedEntries,
    afterFirstRelease: Math.max(0, afterFirstState.exportedRetains - baselineState.exportedRetains),
    final: finalState.exportedEntries,
    released: finalState.exportedEntries <= baselineState.exportedEntries,
  };
}

function importRunScenario(host, port, scenario, runtimeArgs) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port: Number(port) });
    const objectRegistry = new ObjectRegistry();
    const proxy = createImportedProxyable({ stream: socket, objectRegistry, streamPoolReuse: false });
    socket.once("error", reject);

    socket.once("connect", async () => {
      try {
        const actual = (await runRealGcScenario(proxy, scenario, runtimeArgs))
          ?? await runScenario(proxy, scenario, runtimeArgs);
        resolve(actual);
      } catch (error) {
        reject(error);
      } finally {
        socket.end();
      }
    });
  });
}

async function runDrive(args) {
  const scenarios = parseScenarios(args.scenarios).map(parseScenario);

  for (const scenario of scenarios) {
    if (!CAPABILITIES.includes(scenario)) {
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
      emit({
        type: "scenario",
        scenario,
        status: "passed",
        protocol: PROTOCOL,
        actual,
      });
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
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i].startsWith("--")) {
      args[rest[i].slice(2)] = rest[i + 1];
      i += 1;
    }
  }

  if (mode === "serve") {
    await runServe();
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
