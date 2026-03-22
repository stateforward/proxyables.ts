import { Client, Server } from 'yamux-js/cjs';
import { encode, decode } from '@msgpack/msgpack';
import pino from 'pino';
import pretty from 'pino-pretty';
import caller from 'pino-caller';

var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});

// src/types.ts
var ProxyValueKinds = /* @__PURE__ */ ((ProxyValueKinds2) => {
  ProxyValueKinds2[ProxyValueKinds2["function"] = 2664841801] = "function";
  ProxyValueKinds2[ProxyValueKinds2["array"] = 2321067302] = "array";
  ProxyValueKinds2[ProxyValueKinds2["string"] = 398550328] = "string";
  ProxyValueKinds2[ProxyValueKinds2["number"] = 467038368] = "number";
  ProxyValueKinds2[ProxyValueKinds2["boolean"] = 1710517951] = "boolean";
  ProxyValueKinds2[ProxyValueKinds2["symbol"] = 4093333969] = "symbol";
  ProxyValueKinds2[ProxyValueKinds2["object"] = 3099987130] = "object";
  ProxyValueKinds2[ProxyValueKinds2["bigint"] = 2322048458] = "bigint";
  ProxyValueKinds2[ProxyValueKinds2["unknown"] = 2608177081] = "unknown";
  ProxyValueKinds2[ProxyValueKinds2["null"] = 1996966820] = "null";
  ProxyValueKinds2[ProxyValueKinds2["undefined"] = 2606869827] = "undefined";
  ProxyValueKinds2[ProxyValueKinds2["Reference"] = 1511734349] = "Reference";
  return ProxyValueKinds2;
})(ProxyValueKinds || {});
var createLogger = ({ module }) => {
  const isDevelopment = process.env.NODE_ENV === "development";
  const isVitest = process.env.VITEST === "true";
  const envLevel = process.env.PROXYABLE_LOG_LEVEL;
  const level = envLevel ?? (isDevelopment || isVitest ? "debug" : "info");
  const stream = isDevelopment || isVitest ? pretty({
    colorize: true
  }) : void 0;
  const parameters = {
    level,
    module
  };
  return isDevelopment || isVitest ? caller(pino(parameters, stream)) : pino(parameters, stream);
};
var logger = createLogger({ module: "proxyable" });

// src/decoder.ts
var log = logger.child({ module: "proxyable.decoder" });
function createDecoderError(message, received, expected) {
  log.error(
    {
      received,
      expected
    },
    message
  );
  return {
    message,
    received,
    expected
  };
}
function isInstruction(data) {
  return typeof data === "object" && data !== null && "kind" in data;
}
function isArrayOfInstructions(data) {
  return Array.isArray(data) && data.every((instruction) => isInstruction(instruction));
}
function createDecoder() {
  const decoder = {
    [1410115415 /* get */]: (instruction) => {
      return [null, instruction];
    },
    [2621662984 /* local */]: (instruction) => {
      return [null, instruction];
    },
    [3324446467 /* set */]: (instruction) => {
      return [null, instruction];
    },
    [616319547 /* apply */]: (instruction) => {
      return [null, instruction];
    },
    [1086361970 /* construct */]: (instruction) => {
      return [null, instruction];
    },
    [2054714927 /* throw */]: (instruction) => {
      return [null, instruction];
    },
    [2246981567 /* return */]: (instruction) => {
      return [null, instruction];
    },
    [1555467752 /* next */]: (instruction) => {
      return [null, instruction];
    },
    [439041101 /* release */]: (instruction) => {
      return [null, instruction];
    },
    [2686336408 /* execute */]: (instruction) => {
      if (!isArrayOfInstructions(instruction.data)) {
        return [
          createDecoderError(
            `invalid execution data:`,
            instruction.data,
            "ProxyInstructions[]"
          )
        ];
      }
      return [null, instruction];
    },
    decode: (data, kind) => {
      const object = decode(data);
      if (typeof object !== "object" || object === null || !("kind" in object)) {
        return [createDecoderError(`invalid data`, object)];
      }
      if (kind?.length && !kind.includes(object.kind)) {
        return [
          createDecoderError(`invalid instruction kind`, object.kind, kind)
        ];
      }
      const decode3 = decoder[object.kind] ?? ((instruction) => [
        null,
        instruction
      ]);
      return decode3(object);
    }
  };
  return decoder;
}

// src/muid.ts
var cryptoLib;
if (typeof window !== "undefined" && window.crypto) {
  cryptoLib = window.crypto;
} else if (typeof __require !== "undefined") {
  try {
    cryptoLib = __require("crypto");
  } catch (e) {
    cryptoLib = null;
  }
}
function make64(high, low) {
  return {
    high: high >>> 0,
    // Ensure unsigned 32-bit
    low: low >>> 0
  };
}
function from32(value) {
  return make64(0, value >>> 0);
}
function add64(a, b) {
  const low = a.low + b.low >>> 0;
  const carry = a.low + b.low > 4294967295 ? 1 : 0;
  const high = a.high + b.high + carry >>> 0;
  return make64(high, low);
}
function sub64(a, b) {
  const low = a.low - b.low >>> 0;
  const borrow = a.low < b.low ? 1 : 0;
  const high = a.high - b.high - borrow >>> 0;
  return make64(high, low);
}
function shl64(value, bits) {
  if (bits === 0) return value;
  if (bits >= 64) return make64(0, 0);
  if (bits >= 32) {
    return make64(value.low << bits - 32, 0);
  } else {
    const high = value.high << bits | value.low >>> 32 - bits;
    const low = value.low << bits;
    return make64(high >>> 0, low >>> 0);
  }
}
function shr64(value, bits) {
  if (bits === 0) return value;
  if (bits >= 64) return make64(0, 0);
  if (bits >= 32) {
    return make64(0, value.high >>> bits - 32);
  } else {
    const low = value.low >>> bits | value.high << 32 - bits;
    const high = value.high >>> bits;
    return make64(high >>> 0, low >>> 0);
  }
}
function or64(a, b) {
  return make64((a.high | b.high) >>> 0, (a.low | b.low) >>> 0);
}
function and64(a, b) {
  return make64((a.high & b.high) >>> 0, (a.low & b.low) >>> 0);
}
function cmp64(a, b) {
  if (a.high < b.high) return -1;
  if (a.high > b.high) return 1;
  if (a.low < b.low) return -1;
  if (a.low > b.low) return 1;
  return 0;
}
function gte64(a, b) {
  return cmp64(a, b) >= 0;
}
function toString64(value) {
  if (value.high === 0) {
    return value.low.toString();
  }
  let result = "";
  let remainder = make64(value.high, value.low);
  const zero = make64(0, 0);
  while (cmp64(remainder, zero) > 0) {
    let digit = 0;
    const temp = make64(remainder.high, remainder.low);
    for (let i = 9; i >= 0; i--) {
      const test = from32(i);
      if (gte64(temp, test)) {
        digit = i;
        remainder = sub64(remainder, test);
        break;
      }
    }
    result = digit.toString() + result;
    break;
  }
  if (value.high === 0) {
    return value.low.toString();
  } else if (value.high < 2097152) {
    const num = value.high * 4294967296 + value.low;
    return num.toString();
  } else {
    return "0x" + toHex64(value);
  }
}
function toHex64(value) {
  if (value.high === 0) {
    return value.low.toString(16);
  }
  const highHex = value.high.toString(16);
  let lowHex = value.low.toString(16);
  while (lowHex.length < 8) {
    lowHex = "0" + lowHex;
  }
  return highHex + lowHex;
}
function toBase32_64(value) {
  if (value.high === 0) {
    return value.low.toString(32);
  }
  const hex = toHex64(value);
  let num = 0;
  let result = "";
  for (let i = 0; i < hex.length; i++) {
    num = num * 16 + parseInt(hex[i], 16);
    if (num >= 32) {
      result += (num % 32).toString(32);
      num = Math.floor(num / 32);
    }
  }
  if (num > 0) {
    result = num.toString(32) + result;
  }
  return result || "0";
}
function hashString(str) {
  let hash = make64(2166136261, 0);
  const prime = from32(16777619);
  for (let i = 0; i < str.length; i++) {
    const char = from32(str.charCodeAt(i));
    hash = and64(or64(hash, char), make64(0, 4294967295));
    if (hash.high === 0) {
      hash = from32(hash.low * prime.low >>> 0);
    }
  }
  return hash;
}
function getMachineIdentifier() {
  if (typeof __require !== "undefined") {
    try {
      const os = __require("os");
      return os.hostname();
    } catch (e) {
    }
  }
  if (typeof navigator !== "undefined") {
    return navigator.userAgent + navigator.platform + (navigator.hardwareConcurrency || "");
  }
  return "js-" + Math.random().toString(36).substring(2);
}
function getRandomBytes(length) {
  const array = [];
  if (cryptoLib && cryptoLib.getRandomValues) {
    const uintArray = new Uint8Array(length);
    cryptoLib.getRandomValues(uintArray);
    for (let i = 0; i < length; i++) {
      array[i] = uintArray[i];
    }
  } else if (cryptoLib && cryptoLib.randomBytes) {
    const buffer = cryptoLib.randomBytes(length);
    for (let i = 0; i < length; i++) {
      array[i] = buffer[i];
    }
  } else {
    for (let i = 0; i < length; i++) {
      array[i] = Math.floor(Math.random() * 256);
    }
  }
  return array;
}
function getDefaultConfig() {
  const config = {
    timestampBitLen: 41,
    machineIDBitLen: 14
    // epoch default handled in processing
  };
  config.epoch = make64(Math.floor(17e11 / 4294967296), 17e11 & 4294967295);
  const maxMachineID = (1 << (config.machineIDBitLen || 14)) - 1;
  const identifier = getMachineIdentifier();
  let machineID;
  if (identifier) {
    const hash = hashString(identifier);
    machineID = from32(hash.low & maxMachineID);
  } else {
    const randomBytes = getRandomBytes(4);
    let randomValue = 0;
    for (let i = 0; i < 4; i++) {
      randomValue = randomValue << 8 | randomBytes[i];
    }
    machineID = from32(randomValue & maxMachineID);
  }
  config.machineID = machineID;
  return config;
}
var MUID = class {
  value;
  constructor(value) {
    if (typeof value === "number") {
      this.value = from32(value);
    } else if (value && typeof value.high === "number" && typeof value.low === "number") {
      this.value = make64(value.high, value.low);
    } else {
      this.value = make64(0, 0);
    }
  }
  toString() {
    return toBase32_64(this.value);
  }
  toHex() {
    return toHex64(this.value);
  }
  toDecimal() {
    return toString64(this.value);
  }
  valueOf() {
    return this.value;
  }
};
var Generator = class {
  timestampBitLen;
  machineIDBitLen;
  epoch;
  shardIndex;
  shardBitLen;
  counterBitLen;
  timestampBitShift;
  machineIDShift;
  shardIndexShift;
  counterBitMask;
  machineID;
  state;
  constructor(config, shardIndex = 0, shardBitLen = 0) {
    this.timestampBitLen = config.timestampBitLen || 41;
    this.machineIDBitLen = config.machineIDBitLen || 14;
    this.epoch = config.epoch || make64(Math.floor(17e11 / 4294967296), 17e11 & 4294967295);
    this.shardIndex = shardIndex;
    this.shardBitLen = shardBitLen;
    this.counterBitLen = 64 - this.timestampBitLen - this.machineIDBitLen - this.shardBitLen;
    this.timestampBitShift = this.machineIDBitLen + this.shardBitLen + this.counterBitLen;
    this.machineIDShift = this.shardBitLen + this.counterBitLen;
    this.shardIndexShift = this.counterBitLen;
    const counterMask = this.counterBitLen >= 32 ? make64(4294967295, 4294967295) : sub64(shl64(from32(1), this.counterBitLen), from32(1));
    this.counterBitMask = counterMask;
    let machineID = config.machineID || from32(0);
    const machineIDMask = this.machineIDBitLen >= 32 ? make64(4294967295, 4294967295) : sub64(shl64(from32(1), this.machineIDBitLen), from32(1));
    this.machineID = and64(machineID, machineIDMask);
    this.shardIndex = (this.shardIndex & (1 << Math.min(this.shardBitLen, 31)) - 1) >>> 0;
    this.state = from32(1);
  }
  id() {
    let now = sub64(from32(Date.now() & 4294967295), this.epoch);
    const dateNow = Date.now();
    if (dateNow > 4294967295) {
      now = sub64(make64(Math.floor(dateNow / 4294967296), dateNow & 4294967295), this.epoch);
    }
    const lastTimestamp = shr64(this.state, this.counterBitLen);
    let counter = and64(this.state, this.counterBitMask);
    if (cmp64(now, lastTimestamp) < 0) {
      now = lastTimestamp;
    }
    if (cmp64(now, lastTimestamp) === 0) {
      if (gte64(counter, this.counterBitMask)) {
        now = add64(now, from32(1));
        counter = from32(1);
      } else {
        counter = add64(counter, from32(1));
      }
    } else {
      counter = from32(1);
    }
    this.state = or64(shl64(now, this.counterBitLen), counter);
    const timestampPart = shl64(now, this.timestampBitShift);
    const machineIDPart = shl64(this.machineID, this.machineIDShift);
    const shardIndexPart = shl64(from32(this.shardIndex), this.shardIndexShift);
    const muid = or64(or64(or64(timestampPart, machineIDPart), shardIndexPart), counter);
    return new MUID(muid);
  }
};
var ShardedGenerators = class {
  pool;
  size;
  index;
  constructor() {
    let numCPU = 4;
    if (typeof navigator !== "undefined" && navigator.hardwareConcurrency) {
      numCPU = navigator.hardwareConcurrency;
    } else if (typeof __require !== "undefined") {
      try {
        const os = __require("os");
        numCPU = os.cpus().length;
      } catch (e) {
      }
    }
    let shardBits = 0;
    if (numCPU > 1) {
      shardBits = Math.min(Math.ceil(Math.log2(numCPU)), 5);
    }
    const defaultConfig = getDefaultConfig();
    const poolSize = 1 << shardBits;
    this.pool = [];
    this.size = poolSize;
    this.index = 0;
    for (let i = 0; i < poolSize; i++) {
      this.pool.push(new Generator(defaultConfig, i, shardBits));
    }
  }
  next() {
    const generator = this.pool[this.index];
    this.index = (this.index + 1) % this.size;
    return generator;
  }
};
var defaultShards = new ShardedGenerators();
function make() {
  return defaultShards.next().id();
}
function createInstructionUnsafe(kind, data) {
  return {
    id: make().toString(),
    kind,
    data
  };
}
function createThrowInstruction(data) {
  return createInstructionUnsafe(2054714927 /* throw */, data);
}
function createReturnInstruction(data) {
  return createInstructionUnsafe(2246981567 /* return */, data);
}
function createReleaseInstruction(refId) {
  return createInstructionUnsafe(439041101 /* release */, [refId]);
}
var createEncoder = () => {
  return {
    encode: (data) => {
      return encode(data);
    }
  };
};

// src/symbol.ts
var ProxyableSymbol = Object.defineProperties(
  (description) => {
    return Symbol.for(description.toString());
  },
  {
    id: { value: Symbol("id") },
    handler: { value: Symbol("handler") },
    kind: { value: Symbol("kind") },
    schema: { value: Symbol("schema") }
  }
);

// src/registry.ts
var ObjectRegistry = class {
  map = /* @__PURE__ */ new Map();
  counts = /* @__PURE__ */ new Map();
  weakMap = /* @__PURE__ */ new WeakMap();
  register(object) {
    const existingId = this.weakMap.get(object);
    if (existingId) {
      const count = this.counts.get(existingId) ?? 0;
      this.counts.set(existingId, count + 1);
      return existingId;
    }
    const id = make().toString();
    this.map.set(id, object);
    this.counts.set(id, 1);
    this.weakMap.set(object, id);
    return id;
  }
  get(id) {
    return this.map.get(id);
  }
  delete(id) {
    const count = (this.counts.get(id) ?? 0) - 1;
    if (count <= 0) {
      const object = this.map.get(id);
      if (object) {
        this.weakMap.delete(object);
      }
      this.map.delete(id);
      this.counts.delete(id);
    } else {
      this.counts.set(id, count);
    }
  }
  get size() {
    return this.map.size;
  }
  debug() {
    return Array.from(this.map.entries()).map(([id, obj]) => ({ id, type: typeof obj, obj }));
  }
};

// src/stream_pool.ts
var StreamPool = class {
  session;
  max;
  openCount = 0;
  idle = [];
  idleSet = /* @__PURE__ */ new Set();
  pending = [];
  reuse;
  constructor({ session, max, reuse = true }) {
    this.session = session;
    this.max = Math.max(1, max);
    this.reuse = reuse;
  }
  async acquire() {
    const stream = this.idle.pop();
    if (stream) {
      this.idleSet.delete(stream);
      return stream;
    }
    if (this.openCount < this.max) {
      return this.createStream();
    }
    return new Promise((resolve) => this.pending.push(resolve));
  }
  release(stream) {
    if (this.isClosed(stream)) {
      return;
    }
    const waiter = this.pending.shift();
    if (waiter) {
      waiter(stream);
      return;
    }
    if (!this.reuse) {
      stream.destroy();
      return;
    }
    this.idle.push(stream);
    this.idleSet.add(stream);
  }
  createStream() {
    const stream = this.session.open();
    this.openCount += 1;
    const onClose = () => {
      this.cleanupStream(stream);
      if (this.pending.length && this.openCount < this.max) {
        const waiter = this.pending.shift();
        if (waiter) waiter(this.createStream());
      }
    };
    stream.once("close", onClose);
    stream.once("error", onClose);
    return stream;
  }
  cleanupStream(stream) {
    if (this.idleSet.delete(stream)) {
      this.idle = this.idle.filter((item) => item !== stream);
    }
    this.openCount = Math.max(0, this.openCount - 1);
  }
  isClosed(stream) {
    return stream.destroyed || stream.readableEnded && stream.writableEnded;
  }
};

// src/exported.ts
var log2 = logger.child({
  module: "proxyable.exported"
});
function createHandlerError(message) {
  return {
    message
  };
}
var PRIMITIVE_TYPES = [
  "boolean",
  "number",
  "string",
  "symbol",
  "bigint",
  "undefined"
];
function isPrimitive(value) {
  return value === null || PRIMITIVE_TYPES.includes(typeof value);
}
function createProxyableServer(handler) {
  return new Server((stream) => {
    stream.on("data", async (data) => {
      const [error, instruction] = handler.decode(data, [
        2686336408 /* execute */,
        439041101 /* release */
      ]);
      if (error) {
        log2.error(error);
        return stream.write(encode(createThrowInstruction(error)));
      }
      let evalError, evalResult;
      try {
        [evalError, evalResult] = await handler.eval(instruction, []);
      } catch (e) {
        log2.error({ error: e }, "handler logic threw error");
        evalError = createHandlerError(e.message || "Unknown error");
      }
      log2.info({ evalError, evalResult }, `execution result`);
      if (evalError) {
        log2.error({ error: evalError }, `execution error`);
      }
      const bytes = encode(
        evalError ? createThrowInstruction(evalError) : evalResult
      );
      log2.info({ results: evalResult }, `sending results`);
      stream.write(Buffer.from(bytes));
    });
  });
}
function createExportedProxyable(parameters) {
  const object = parameters.object;
  const registry = parameters.registry ?? new ObjectRegistry();
  let streamPool = null;
  const createValue2 = (value, kind) => {
    if (typeof kind !== "number") {
      kind = ProxyValueKinds[typeof value];
    }
    if (!kind && value !== null && typeof value === "object") {
      kind = 3099987130 /* object */;
      kind = 3099987130 /* object */;
    }
    log2.info({ value, kind, type: typeof value }, `creating unproxyable value`);
    if (isPrimitive(value)) {
      if (kind === void 0) kind = ProxyValueKinds[typeof value];
      return {
        id: make().toString(),
        kind,
        data: value
      };
    }
    if (typeof value === "function" || typeof value === "object" && value !== null) {
      const refId = registry.register(value);
      return {
        id: make().toString(),
        kind: 1511734349 /* Reference */,
        data: refId
      };
    }
    return {
      id: make().toString(),
      kind,
      data: value
    };
  };
  const { decode: decode3 } = parameters.decoder ?? createDecoder();
  const { encode: encode3 } = parameters.encoder ?? createEncoder();
  const id = make().toString();
  const boundMethodCache = /* @__PURE__ */ new WeakMap();
  const getStreamPool = () => {
    if (!streamPool) {
      streamPool = new StreamPool({
        session: server,
        max: parameters.streamPoolSize ?? 8,
        reuse: parameters.streamPoolReuse ?? true
      });
    }
    return streamPool;
  };
  const handler = parameters.handler ?? {
    get stream() {
      return server;
    },
    decode: decode3,
    encode: encode3,
    [2686336408 /* execute */]: async (data, stack = []) => {
      log2.info({ data }, `executing instructions`);
      for (const instruction of data) {
        if (instruction.kind === 1511734349 /* Reference */) {
          stack.push(instruction);
          continue;
        }
        const operation = handler?.[instruction.kind];
        if (!operation) {
          continue;
        }
        let currentTarget = object;
        if (stack.length > 0) {
          const previous = stack[stack.length - 1];
          if (previous.kind === 1511734349 /* Reference */) {
            const refId = previous.data;
            const registered = registry.get(refId);
            if (registered) {
              currentTarget = registered;
              stack.pop();
            }
          }
        }
        const [error, result2] = await operation(instruction.data, stack, currentTarget);
        if (error) {
          return [error];
        }
        stack.push(result2);
      }
      const result = stack.shift();
      if (!result) {
        return [createHandlerError("no result")];
      }
      return [null, createReturnInstruction(result)];
    },
    [1410115415 /* get */]: async (data, stack = [], target = object) => {
      log2.info({ data }, `getting value`);
      const [key] = data;
      let val = target[key];
      if (typeof val === "function") {
        try {
          let cache = boundMethodCache.get(target);
          if (!cache) {
            cache = /* @__PURE__ */ new Map();
            boundMethodCache.set(target, cache);
          }
          const cached = cache.get(key);
          if (cached) {
            val = cached;
          } else {
            val = val.bind(target);
            cache.set(key, val);
          }
        } catch (e) {
        }
      }
      return [null, createValue2(val)];
    },
    [616319547 /* apply */]: async (data, stack = [], target = object) => {
      const args = data.map((arg) => {
        if (arg && typeof arg === "object" && arg.kind === 1511734349 /* Reference */) {
          const refId = arg.data;
          return new Proxy(function() {
          }, {
            apply: async (_, __, callArgs) => {
              const substream = await getStreamPool().acquire();
              [
                { kind: 1511734349 /* Reference */, data: refId, id: make().toString() },
                createInstructionUnsafe(616319547 /* apply */, callArgs)
                // Note: callArgs might need hydration too if complex!
                // For now assuming primitives or handled by encoder logic?
                // Encoder logic in imported.ts handles recursive createValue? 
                // No, encoder handles msgpack. 
                // We should use createValue here too if we want to pass Server Objects back to Client Callback!
                // But createValue is local.
              ];
              const transformedCallArgs = callArgs.map((a) => createValue2(a));
              const finalInstructions = [
                { kind: 1511734349 /* Reference */, data: refId, id: make().toString() },
                createInstructionUnsafe(616319547 /* apply */, transformedCallArgs)
              ];
              const execInstruction = createInstructionUnsafe(
                2686336408 /* execute */,
                finalInstructions
              );
              return new Promise((resolve, reject) => {
                const cleanup = () => {
                  substream.removeAllListeners("data");
                  substream.removeAllListeners("error");
                  getStreamPool().release(substream);
                };
                substream.on("data", (d) => {
                  const [err, res] = decode3(d, [2246981567 /* return */, 2054714927 /* throw */]);
                  if (err) {
                    reject(new Error(err.message));
                  } else {
                    const val = res.data;
                    if (val && typeof val === "object" && val.kind === 1511734349 /* Reference */) ;
                    resolve(val?.data ?? val);
                  }
                  cleanup();
                });
                substream.on("error", (error) => {
                  cleanup();
                  reject(error);
                });
                substream.write(Buffer.from(encode3(execInstruction)));
              });
            }
            // TODO: Release/GC support for callbacks?
            // If server drops this proxy, we should send release(ID) to client.
          });
        }
        return arg;
      });
      if (typeof target === "function") {
        const result = await Reflect.apply(target, object, args);
        return [null, createValue2(result)];
      }
      return [createHandlerError("target is not a function")];
    },
    [1086361970 /* construct */]: async (data, stack = [], target = object) => {
      const args = data.map((arg) => {
        if (arg && typeof arg === "object" && arg.kind === 1511734349 /* Reference */) {
          const refId = arg.data;
          return new Proxy(function() {
          }, {
            apply: async (_, __, callArgs) => {
              const substream = await getStreamPool().acquire();
              const transformedCallArgs = callArgs.map((a) => createValue2(a));
              const finalInstructions = [
                { kind: 1511734349 /* Reference */, data: refId, id: make().toString() },
                createInstructionUnsafe(616319547 /* apply */, transformedCallArgs)
              ];
              const execInstruction = createInstructionUnsafe(2686336408 /* execute */, finalInstructions);
              return new Promise((resolve, reject) => {
                const cleanup = () => {
                  substream.removeAllListeners("data");
                  substream.removeAllListeners("error");
                  getStreamPool().release(substream);
                };
                substream.on("data", (d) => {
                  const [err, res] = decode3(d, [2246981567 /* return */, 2054714927 /* throw */]);
                  if (err) reject(new Error(err.message));
                  else resolve(res.data?.data ?? res.data);
                  cleanup();
                });
                substream.on("error", (error) => {
                  cleanup();
                  reject(error);
                });
                substream.write(Buffer.from(encode3(execInstruction)));
              });
            }
          });
        }
        return arg;
      });
      if (typeof target === "function") {
        const result = Reflect.construct(target, args);
        return [null, createValue2(result)];
      }
      return [createHandlerError("target is not a constructor")];
    },
    [439041101 /* release */]: async (data, stack = []) => {
      const [refId] = data;
      log2.info({ refId }, "releasing object reference");
      registry.delete(refId);
      return [null, createValue2(void 0)];
    },
    eval: async (instruction, stack = []) => {
      let target = object;
      if (instruction.metadata && instruction.metadata.target) {
        const t = registry.get(instruction.metadata.target);
        if (t) target = t;
      }
      const operation = handler?.[instruction.kind];
      if (!operation) {
        return [
          createHandlerError(`unknown instruction kind ${instruction.kind}`)
        ];
      }
      const [error, result] = await operation(instruction.data, stack, target);
      if (error) {
        log2.error({ error }, `eval error`);
        return [error];
      }
      log2.info({ result }, `eval result`);
      return [null, result];
    },
    get(target, key) {
      if (key === ProxyableSymbol.handler) {
        return handler;
      }
      if (key === ProxyableSymbol.id) {
        return id;
      }
      return [null, createValue2(object[key])];
    }
  };
  const server = createProxyableServer(handler);
  if (parameters.stream) {
    parameters.stream.pipe(server).pipe(parameters.stream);
  }
  return new Proxy(object, handler);
}
var log3 = logger.child({ module: "proxyable.imported" });
var INSPECT_SYMBOL = Symbol.for("nodejs.util.inspect.custom");
var PRIMITIVE_TYPES2 = [
  "boolean",
  "number",
  "string",
  "symbol",
  "bigint",
  "undefined"
];
function isPrimitive2(value) {
  return value === null || PRIMITIVE_TYPES2.includes(typeof value);
}
function createValue(registry, value) {
  if (isPrimitive2(value)) {
    return value;
  }
  if (typeof value === "function" || typeof value === "object" && value !== null) {
    const id = registry.register(value);
    return {
      id: make().toString(),
      kind: 1511734349 /* Reference */,
      data: id
    };
  }
  return value;
}
function unwrapResult(result, context) {
  if (result.kind === 2246981567 /* return */) {
    const returnInstr = result;
    const value = returnInstr.data;
    if (value.kind === 1511734349 /* Reference */) {
      log3.info({ refId: value.data }, "hydrating reference");
      const proxy = createProxyCursor(context, [{
        id: make().toString(),
        kind: 1511734349 /* Reference */,
        data: value.data
      }]);
      if (context.registry) {
        context.registry.register(proxy, { refId: value.data });
      }
      return proxy;
    }
    if (value.kind === 2606869827 /* undefined */) {
      return void 0;
    }
    if (value.kind === 1996966820 /* null */) {
      return null;
    }
    return value.data;
  }
  return result;
}
function createProxyCursor(context, instructions) {
  const object = Object.defineProperties(function() {
  }, {
    name: { value: `ProxyableImport` },
    // ID is harder to track per cursor, maybe unnecessary?
    [Symbol.toStringTag]: { value: "ProxyableImport" },
    [INSPECT_SYMBOL]: {
      value: () => {
        if (instructions.length === 0) return "ProxyableImport(root)";
        if (instructions.length === 1 && instructions[0].kind === 1511734349 /* Reference */) {
          return `ProxyableImport(ref:${String(instructions[0].data)})`;
        }
        const kinds = instructions.map((instruction) => instruction.kind);
        return `ProxyableImport(pending:${kinds.join(",")})`;
      }
    }
  });
  const handler = {
    get: (_, key) => {
      if (key === ProxyableSymbol.id) return "UNKNOWN";
      if (key === ProxyableSymbol.handler) return handler;
      if (key === Symbol.toStringTag) return "ProxyableImport";
      if (key === INSPECT_SYMBOL) {
        return () => {
          if (instructions.length === 0) return "ProxyableImport(root)";
          if (instructions.length === 1 && instructions[0].kind === 1511734349 /* Reference */) {
            return `ProxyableImport(ref:${String(instructions[0].data)})`;
          }
          const kinds = instructions.map((instruction) => instruction.kind);
          return `ProxyableImport(pending:${kinds.join(",")})`;
        };
      }
      const isReferenceHolder = instructions.length === 1 && instructions[0].kind === 1511734349 /* Reference */;
      if (key === "then") {
        if (instructions.length === 0 || isReferenceHolder) return void 0;
        return (resolve, reject) => {
          executeInstructions(context, instructions).then(([err, res]) => {
            if (err) return reject(err);
            try {
              const val = unwrapResult(res, context);
              resolve(val);
            } catch (e) {
              reject(e);
            }
          }).catch(reject);
        };
      }
      const newInstructions = [
        ...instructions,
        createInstructionUnsafe(1410115415 /* get */, [key.toString()])
      ];
      return createProxyCursor(context, newInstructions);
    },
    apply: (_, __, args) => {
      const transformedArgs = args.map((arg) => createValue(context.objectRegistry, arg));
      const newInstructions = [
        ...instructions,
        createInstructionUnsafe(616319547 /* apply */, transformedArgs)
      ];
      return createProxyCursor(context, newInstructions);
    },
    construct: (_, args) => {
      const transformedArgs = args.map((arg) => createValue(context.objectRegistry, arg));
      const newInstructions = [
        ...instructions,
        createInstructionUnsafe(1086361970 /* construct */, transformedArgs)
      ];
      return createProxyCursor(context, newInstructions);
    }
  };
  handler.stream = context.client;
  return new Proxy(object, handler);
}
async function executeInstructions(context, instructions) {
  return new Promise((resolve, reject) => {
    const { encoder, decoder, streamPool } = context;
    let substream = null;
    const execInstruction = createInstructionUnsafe(
      2686336408 /* execute */,
      instructions
    );
    const cleanup = () => {
      if (!substream) return;
      substream.removeAllListeners("data");
      substream.removeAllListeners("error");
      streamPool.release(substream);
      substream = null;
    };
    const handleData = (data) => {
      const [error, instruction] = decoder(data, [
        2054714927 /* throw */,
        2246981567 /* return */,
        1555467752 /* next */
      ]);
      if (error) {
        log3.error({ error }, `execution error`);
        cleanup();
        resolve([error]);
        return;
      }
      cleanup();
      resolve([null, instruction]);
    };
    const handleError = (error) => {
      log3.error(error);
      cleanup();
      reject(error);
    };
    streamPool.acquire().then((stream) => {
      substream = stream;
      substream.on("data", handleData);
      substream.on("error", handleError);
      const bytes = encoder(execInstruction);
      log3.info(
        { instruction: execInstruction },
        `sending ${execInstruction.kind} instruction`
      );
      substream.write(Buffer.from(bytes));
    }).catch(handleError);
  });
}
function createImportedProxyable({
  stream,
  decoder,
  encoder,
  streamPoolSize = 8,
  streamPoolReuse = true
}) {
  const client = new Client();
  const { decode: decode3 } = decoder ?? createDecoder();
  const { encode: encode3 } = encoder ?? createEncoder();
  stream.pipe(client).pipe(stream);
  const objectRegistry = new ObjectRegistry();
  const registry = new FinalizationRegistry((heldValue) => {
    try {
      const substream = client.open();
      const instruction = createReleaseInstruction(heldValue.refId);
      const bytes = encode3(instruction);
      substream.write(Buffer.from(bytes));
      if (typeof substream.close === "function") {
        substream.close();
      } else {
        substream.end();
      }
    } catch (e) {
      console.error("failed to release reference", e);
    }
  });
  const streamPool = new StreamPool({ session: client, max: streamPoolSize, reuse: streamPoolReuse });
  const handleStream = (stream2) => {
    stream2.on("data", async (data) => {
      const [error, instruction] = decode3(data, [
        2686336408 /* execute */,
        439041101 /* release */
      ]);
      if (error) {
        log3.error(error);
        return stream2.write(encode3(createThrowInstruction(error)));
      }
      const execute = async () => {
        if (instruction.kind === 439041101 /* release */) {
          const [refId] = instruction.data;
          objectRegistry.delete(refId);
          return createValue(objectRegistry, void 0);
        }
        if (instruction.kind === 2686336408 /* execute */) {
          const stack = [];
          const instructions = instruction.data;
          for (const instr of instructions) {
            if (instr.kind === 1511734349 /* Reference */) {
              stack.push(instr);
              continue;
            }
            let target = void 0;
            if (stack.length > 0) {
              const head = stack[stack.length - 1];
              if (head.kind === 1511734349 /* Reference */) {
                target = objectRegistry.get(head.data);
                stack.pop();
              }
            }
            if (!target) {
              return createThrowInstruction({ message: "No target for operation" });
            }
            if (instr.kind === 616319547 /* apply */) {
              if (typeof target === "function") {
                try {
                  const args = instr.data.map((arg) => {
                    if (arg && typeof arg === "object" && arg.kind === 1511734349 /* Reference */) {
                      return unwrapResult({ kind: 2246981567 /* return */, data: arg }, { client, decoder: decode3, encoder: encode3, registry, objectRegistry, streamPool });
                    }
                    return arg;
                  });
                  const result = await Reflect.apply(target, void 0, args);
                  return createReturnInstruction(createValue(objectRegistry, result));
                } catch (e) {
                  return createThrowInstruction({ message: e.message });
                }
              }
            }
          }
          if (stack.length > 0) {
            return createReturnInstruction(stack.pop());
          }
          return createReturnInstruction(createValue(objectRegistry, void 0));
        }
        return createThrowInstruction({ message: "Unknown instruction" });
      };
      try {
        const res = await execute();
        stream2.write(Buffer.from(encode3(res)));
      } catch (e) {
        stream2.write(Buffer.from(encode3(createThrowInstruction({ message: e.message }))));
      }
    });
  };
  client.onStream = handleStream;
  return createProxyCursor(
    { client, decoder: decode3, encoder: encode3, registry, objectRegistry, streamPool },
    []
  );
}

// src/proxyable.ts
var Proxyable = class _Proxyable {
  static exports = {};
  static imports = {};
  static export({
    object,
    stream,
    handler,
    schema
  }) {
    const proxy = createExportedProxyable({ stream, object, handler });
    _Proxyable.exports[proxy[ProxyableSymbol.id]] = proxy;
    return proxy;
  }
  static import({
    stream,
    schema
  }) {
    const proxy = createImportedProxyable({ stream });
    _Proxyable.imports[proxy[ProxyableSymbol.id]] = proxy;
    return proxy;
  }
};

export { Proxyable };
