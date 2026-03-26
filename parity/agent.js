#!/usr/bin/env node
"use strict";

const net = require("node:net");

const PROTOCOL = "parity-json-v1";
const CANONICAL_SCENARIOS = [
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
const CAPABILITIES = [
  ...CANONICAL_SCENARIOS,
];
const CAPABILITY_SET = new Set(CAPABILITIES);

const WORD_BOUNDARY = /[A-Z]?[a-z0-9]+|[A-Z]+(?![a-z])/g;

function toPascalCase(raw) {
  const matches = String(raw).match(WORD_BOUNDARY);
  if (!matches || matches.length === 0) {
    return String(raw)
      .split(/[^a-zA-Z0-9]+/)
      .filter(Boolean)
      .map((item) => `${item[0]?.toUpperCase()}${item.slice(1)}`)
      .join("");
  }
  return matches
    .map((item) => `${item[0]?.toUpperCase()}${item.slice(1).toLowerCase()}`)
    .join("");
}

function normalizeScenario(raw) {
  const canonical = toPascalCase(raw);
  if (CAPABILITY_SET.has(canonical)) {
    return canonical;
  }
  return "";
}

function emit(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function createFixture() {
  class Greeter {
    constructor(prefix) {
      this.prefix = prefix;
    }

    greet(name) {
      return `${this.prefix} ${name}`;
    }
  }

  const shared = { kind: "shared", value: "shared" };
  const state = {
    nextSharedId: 0,
    activeRefs: new Set(),
  };

  return {
    intValue: 42,
    boolValue: true,
    stringValue: "hello",
    nullValue: null,
    nested: {
      label: "nested",
      ping() {
        return "pong";
      },
    },
    Greeter,
    add(a, b) {
      return a + b;
    },
    echo(value) {
      return value;
    },
    runCallback(cb, value) {
      return cb(value);
    },
    useHelper(helper, name) {
      return helper.greet(name);
    },
    explode() {
      throw new Error("Boom");
    },
    getShared() {
      return shared;
    },
    acquireShared() {
      const refId = `shared-${++state.nextSharedId}`;
      state.activeRefs.add(refId);
      return { kind: shared.kind, value: shared.value, __refId: refId };
    },
    releaseShared(refId) {
      if (typeof refId === "string") {
        state.activeRefs.delete(refId);
        return;
      }
      if (refId && typeof refId === "object" && typeof refId.__refId === "string") {
        state.activeRefs.delete(refId.__refId);
      }
    },
    debugStats() {
      return {
        active: state.activeRefs.size,
        total: state.nextSharedId,
      };
    },
  };
}

function parseScenarios(raw) {
  return String(raw || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function runScenario(fixture, scenario) {
  const normalized = normalizeScenario(scenario);
  if (!normalized) {
    throw new Error(`unknown scenario: ${scenario}`);
  }

  switch (normalized) {
    case "GetScalars": {
      return {
        intValue: fixture.intValue,
        boolValue: fixture.boolValue,
        stringValue: fixture.stringValue,
        nullValue: fixture.nullValue,
      };
    }
    case "CallAdd":
      return fixture.add(20, 22);
    case "NestedObjectAccess": {
      const nested = fixture.nested;
      return {
        label: nested.label,
        pong: nested.ping(),
      };
    }
    case "ConstructGreeter": {
      const greeter = new fixture.Greeter("Hello");
      return greeter.greet("World");
    }
    case "CallbackRoundtrip":
      return fixture.runCallback((value) => `callback:${value}`, "value");
    case "ObjectArgumentRoundtrip":
      return fixture.useHelper(
        {
          greet(name) {
            return `helper:${name}`;
          },
        },
        "Ada"
      );
    case "ErrorPropagation": {
      try {
        fixture.explode();
      } catch (error) {
        return error.message;
      }
      throw new Error("expected failure");
    }
    case "SharedReferenceConsistency": {
      const first = fixture.getShared();
      const second = fixture.getShared();
      return {
        firstKind: first.kind,
        secondKind: second.kind,
        firstValue: first.value,
        secondValue: second.value,
      };
    }
    case "ExplicitRelease": {
      const before = fixture.debugStats();
      const first = fixture.acquireShared();
      const second = fixture.acquireShared();
      fixture.releaseShared(first);
      fixture.releaseShared(second);
      const after = fixture.debugStats();
      return {
        before: before.active,
        after: after.active,
        acquired: 2,
      };
    }
    default:
      throw new Error(`unknown scenario: ${scenario}`);
  }
}

async function connect(host, port) {
  return await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port: Number(port) });
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith("--")) {
      continue;
    }
    out[item.slice(2)] = argv[i + 1];
    i += 1;
  }
  return out;
}

async function runServe(args) {
  const fixture = createFixture();
  const server = net.createServer((socket) => {
    let request = "";
    socket.setEncoding("utf8");

    const sendLine = (payload) => {
      socket.write(`${JSON.stringify(payload)}\n`);
    };

    const handle = () => {
      const scenarios = parseScenarios(request);
      for (const scenario of scenarios) {
        const canonical = normalizeScenario(scenario);
        if (!canonical) {
          sendLine({
            type: "scenario",
            scenario,
            status: "unsupported",
            protocol: PROTOCOL,
            message: "unsupported",
          });
          continue;
        }
        try {
          const actual = runScenario(fixture, canonical);
          sendLine({
            type: "scenario",
            scenario: canonical,
            status: "passed",
            protocol: PROTOCOL,
            actual,
          });
        } catch (error) {
          sendLine({
            type: "scenario",
            scenario: canonical,
            status: "failed",
            protocol: PROTOCOL,
            message: error.message,
          });
        }
      }
      if (scenarios.length === 0) {
        sendLine({
          type: "scenario",
          scenario: "none",
          status: "passed",
          protocol: PROTOCOL,
          actual: {},
        });
      }
      socket.end();
    };

    socket.on("data", (chunk) => {
      request += chunk;
    });
    socket.on("end", handle);
    socket.on("error", () => {
      socket.destroy();
    });
  });

  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    emit({
      type: "ready",
      lang: "ts",
      protocol: PROTOCOL,
      capabilities: CAPABILITIES,
      port: address.port,
    });
  });

  await new Promise(() => {});
  return { server };
}

async function runDrive(args) {
  const scenarios = parseScenarios(args.scenarios).map((scenario) => normalizeScenario(scenario) || scenario);
  const socket = await connect(args.host, args.port);
  const responses = [];

  socket.setEncoding("utf8");
  socket.on("data", (chunk) => {
    responses.push(chunk);
  });

  const payload = `${scenarios.join(",")}\n`;
  socket.end(payload, "utf8");

  await new Promise((resolve, reject) => {
    socket.on("end", resolve);
    socket.on("error", reject);
  });

  const lines = responses
    .join("")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const seen = new Set();
  for (const line of lines) {
    try {
      const payload = JSON.parse(line);
      if (payload.type === "scenario" && typeof payload.scenario === "string") {
        seen.add(payload.scenario);
      }
      emit(payload);
    } catch {
      continue;
    }
  }

  for (const scenario of scenarios) {
    if (!seen.has(scenario)) {
      emit({
        type: "scenario",
        scenario,
        status: "failed",
        protocol: PROTOCOL,
        message: "server did not emit a result",
      });
    }
  }
}

async function main() {
  const [mode, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  if (mode === "serve") {
    await runServe(args);
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
