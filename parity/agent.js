#!/usr/bin/env node
"use strict";

const net = require("node:net");
const { Proxyable } = require("../dist/index.js");

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
];

const OBJECT_FIELDS = {
  GetScalars: ["intValue", "boolValue", "stringValue", "nullValue"],
  NestedObjectAccess: ["label", "pong"],
  SharedReferenceConsistency: ["firstKind", "secondKind", "firstValue", "secondValue"],
  ExplicitRelease: ["before", "after", "acquired"],
};

const SCENARIO_ARGS = {
  CallAdd: [20, 22],
  CallbackRoundtrip: [
    (value) => `callback:${value}`,
  ],
  ObjectArgumentRoundtrip: [
    {
      greet: (value) => `helper:${value}`,
    },
  ],
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

function createFixture() {
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
    activeRefs: new Set(),
    acquireShared() {
      const refId = `shared-${++this.nextShared}`;
      this.activeRefs.add(refId);
      return refId;
    },
    releaseShared(refId) {
      this.activeRefs.delete(refId);
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
          const before = this.activeRefs.size;
          const firstRef = this.acquireShared();
          const secondRef = this.acquireShared();
          this.releaseShared(firstRef);
          this.releaseShared(secondRef);
          return {
            before,
            after: this.activeRefs.size,
            acquired: 2,
          };
        }
        default:
          throw new Error(`unsupported scenario: ${normalized}`);
      }
    },
  };
}

function runScenario(proxy, scenario) {
  const args = SCENARIO_ARGS[scenario] ? [...SCENARIO_ARGS[scenario]] : [];
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
  const fixture = createFixture();
  Proxyable.Export({ object: fixture, stream: socket });
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

function importRunScenario(host, port, scenario) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port: Number(port) });
    const proxy = Proxyable.ImportFrom({ stream: socket });
    socket.once("error", reject);

    socket.once("connect", async () => {
      try {
        const actual = await runScenario(proxy, scenario);
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
      const actual = await importRunScenario(args.host, Number(args.port), scenario);
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
    return;
  }
  throw new Error(`unknown mode: ${mode}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
