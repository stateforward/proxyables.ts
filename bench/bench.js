const { performance } = require("perf_hooks");
const path = require("path");
const fs = require("fs");

const DEFAULT_ITERATIONS = 1000;
const DEFAULT_WARMUP = 100;
const DEFAULT_PAYLOAD_BYTES = 4096;
const DEFAULT_RESULTS_DIR = path.join(__dirname, "results");

const argv = process.argv.slice(2);
const args = {};
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (arg === "--adapter" || arg === "-a") {
    args.adapter = argv[++i];
  } else if (arg === "--iterations" || arg === "-n") {
    args.iterations = Number(argv[++i]);
  } else if (arg === "--warmup") {
    args.warmup = Number(argv[++i]);
  } else if (arg === "--only") {
    args.only = argv[++i];
  } else if (arg === "--payloadBytes") {
    args.payloadBytes = Number(argv[++i]);
  } else if (arg === "--outDir") {
    args.outDir = argv[++i];
  } else if (arg === "--tag") {
    args.tag = argv[++i];
  } else if (arg === "--all") {
    args.all = true;
  } else if (arg === "--list") {
    args.list = true;
  } else if (arg === "--help" || arg === "-h") {
    args.help = true;
  }
}

const adaptersDir = path.join(__dirname, "adapters");
const adapterFiles = fs
  .readdirSync(adaptersDir)
  .filter((file) => file.endsWith(".js"))
  .map((file) => file.replace(/\.js$/, ""));

if (args.help) {
  console.log(`Usage: node bench/bench.js [options]

Options:
  -a, --adapter <name>     Adapter to run (default: proxyables)
  -n, --iterations <num>   Iterations per scenario (default: ${DEFAULT_ITERATIONS})
  --warmup <num>           Warmup iterations (default: ${DEFAULT_WARMUP})
  --payloadBytes <num>     Payload size for large payload scenarios (default: ${DEFAULT_PAYLOAD_BYTES})
  --outDir <path>          Directory for snapshot output (default: bench/results)
  --tag <text>             Optional tag added to snapshot filename
  --all                    Run all available adapters
  --only <scenario>        Run a single scenario by name
  --list                   List available adapters
  -h, --help               Show help
`);
  process.exit(0);
}

if (args.list) {
  console.log("Available adapters:");
  adapterFiles.forEach((name) => console.log(`- ${name}`));
  process.exit(0);
}

const iterations = Number.isFinite(args.iterations)
  ? args.iterations
  : DEFAULT_ITERATIONS;
const warmup = Number.isFinite(args.warmup) ? args.warmup : DEFAULT_WARMUP;
const payloadBytes = Number.isFinite(args.payloadBytes)
  ? args.payloadBytes
  : DEFAULT_PAYLOAD_BYTES;
const outDir = args.outDir
  ? path.resolve(process.cwd(), args.outDir)
  : DEFAULT_RESULTS_DIR;

async function runScenario(name, fn, context) {
  for (let i = 0; i < warmup; i += 1) {
    await fn(context);
  }
  const start = performance.now();
  for (let i = 0; i < iterations; i += 1) {
    await fn(context);
  }
  const end = performance.now();
  const totalMs = end - start;
  const ops = (iterations / totalMs) * 1000;
  return { totalMs, ops };
}

function withMutedOutput(fn) {
  const stdoutWrite = process.stdout.write;
  const stderrWrite = process.stderr.write;
  process.stdout.write = () => true;
  process.stderr.write = () => true;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      process.stdout.write = stdoutWrite;
      process.stderr.write = stderrWrite;
    });
}

async function runAdapter(adapterName) {
  const adapterPath = path.join(adaptersDir, `${adapterName}.js`);
  if (!fs.existsSync(adapterPath)) {
    console.error(`Adapter not found: ${adapterName}`);
    console.error("Use --list to see available adapters.");
    process.exit(1);
  }
  const previousLogLevel = process.env.PROXYABLE_LOG_LEVEL;
  if (adapterName.startsWith("proxyables")) {
    process.env.PROXYABLE_LOG_LEVEL = "silent";
  }
  const adapter = require(adapterPath);
  const context = await adapter.setup({ iterations, warmup, payloadBytes });
  const scenarioEntries = Object.entries(adapter.scenarios || {});
  const filtered = args.only
    ? scenarioEntries.filter(([name]) => name === args.only)
    : scenarioEntries;

  if (!filtered.length) {
    console.error("No scenarios found.");
    process.exit(1);
  }

  console.log(`Adapter: ${adapter.name || adapterName}`);
  console.log(
    `Iterations: ${iterations} | Warmup: ${warmup} | Payload: ${payloadBytes} bytes`
  );

  const results = [];
  const runAllScenarios = async () => {
    for (const [name, fn] of filtered) {
      const { totalMs, ops } = await runScenario(name, fn, context);
      results.push({ name, totalMs, ops });
    }
  };
  if (adapter.muteOutput) {
    await withMutedOutput(runAllScenarios);
  } else {
    await runAllScenarios();
  }

  await adapter.teardown(context);
  if (previousLogLevel === undefined) {
    delete process.env.PROXYABLE_LOG_LEVEL;
  } else {
    process.env.PROXYABLE_LOG_LEVEL = previousLogLevel;
  }

  console.log("\nResults:");
  results.forEach((row) => {
    const avgMs = row.totalMs / iterations;
    console.log(
      `- ${row.name}: ${avgMs.toFixed(4)} ms/op | ${row.ops.toFixed(1)} ops/sec`
    );
  });

  const timestamp = new Date().toISOString();
  const safeTimestamp = timestamp.replace(/[:.]/g, "-");
  const tag = args.tag ? `-${args.tag}` : "";
  const filename = `${safeTimestamp}-${adapter.name || adapterName}${tag}.json`;
  fs.mkdirSync(outDir, { recursive: true });
  const snapshot = {
    timestamp,
    adapter: adapter.name || adapterName,
    iterations,
    warmup,
    payloadBytes,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    scenarios: results.map((row) => ({
      name: row.name,
      totalMs: row.totalMs,
      avgMs: row.totalMs / iterations,
      ops: row.ops,
    })),
  };
  const outPath = path.join(outDir, filename);
  fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2));
  console.log(`\nSnapshot: ${outPath}`);
}

async function run() {
  if (args.all) {
    for (const adapterName of adapterFiles) {
      await runAdapter(adapterName);
      console.log("");
    }
    return;
  }

  const adapterName = args.adapter || "proxyables";
  await runAdapter(adapterName);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
