/**
 * @fileoverview Monotonically Unique ID (MUID) generator for Espruino
 * Port of the Go muid package implementing 64-bit unique IDs using two 32-bit numbers.
 * 
 * Default layout: [41 bits timestamp] [14 bits machine ID] [9 bits counter]
 * The bit allocation and epoch can be customized via the Config object.
 */

// Crypto API for random values (browser/Node.js compatible)
let cryptoLib: any;
if (typeof window !== 'undefined' && window.crypto) {
  cryptoLib = window.crypto;
} else if (typeof require !== 'undefined') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    cryptoLib = require('crypto');
  } catch (e) {
    // Fall back to global or no crypto
    cryptoLib = null;
  }
}

/**
 * 64-bit arithmetic using two 32-bit numbers
 */

type Uint64 = { high: number; low: number };

/**
 * Create a 64-bit value from high and low 32-bit parts
 */
export function make64(high: number, low: number): Uint64 {
  return {
    high: (high >>> 0), // Ensure unsigned 32-bit
    low: (low >>> 0)
  };
}

/**
 * Convert a regular number to 64-bit representation
 */
export function from32(value: number): Uint64 {
  return make64(0, value >>> 0);
}

/**
 * Add two 64-bit numbers
 */
export function add64(a: Uint64, b: Uint64): Uint64 {
  const low = (a.low + b.low) >>> 0;
  const carry = (a.low + b.low) > 0xFFFFFFFF ? 1 : 0;
  const high = (a.high + b.high + carry) >>> 0;
  return make64(high, low);
}

/**
 * Subtract two 64-bit numbers
 */
export function sub64(a: Uint64, b: Uint64): Uint64 {
  const low = (a.low - b.low) >>> 0;
  const borrow = a.low < b.low ? 1 : 0;
  const high = (a.high - b.high - borrow) >>> 0;
  return make64(high, low);
}

/**
 * Left shift 64-bit number
 */
export function shl64(value: Uint64, bits: number): Uint64 {
  if (bits === 0) return value;
  if (bits >= 64) return make64(0, 0);

  if (bits >= 32) {
    return make64(value.low << (bits - 32), 0);
  } else {
    const high = (value.high << bits) | (value.low >>> (32 - bits));
    const low = value.low << bits;
    return make64(high >>> 0, low >>> 0);
  }
}

/**
 * Right shift 64-bit number
 */
export function shr64(value: Uint64, bits: number): Uint64 {
  if (bits === 0) return value;
  if (bits >= 64) return make64(0, 0);

  if (bits >= 32) {
    return make64(0, value.high >>> (bits - 32));
  } else {
    const low = (value.low >>> bits) | (value.high << (32 - bits));
    const high = value.high >>> bits;
    return make64(high >>> 0, low >>> 0);
  }
}

/**
 * Bitwise OR of two 64-bit numbers
 */
export function or64(a: Uint64, b: Uint64): Uint64 {
  return make64((a.high | b.high) >>> 0, (a.low | b.low) >>> 0);
}

/**
 * Bitwise AND of two 64-bit numbers
 */
export function and64(a: Uint64, b: Uint64): Uint64 {
  return make64((a.high & b.high) >>> 0, (a.low & b.low) >>> 0);
}

/**
 * Compare two 64-bit numbers
 * @returns -1 if a < b, 0 if a === b, 1 if a > b
 */
export function cmp64(a: Uint64, b: Uint64): number {
  if (a.high < b.high) return -1;
  if (a.high > b.high) return 1;
  if (a.low < b.low) return -1;
  if (a.low > b.low) return 1;
  return 0;
}

/**
 * Check if 64-bit number is greater than or equal to another
 */
export function gte64(a: Uint64, b: Uint64): boolean {
  return cmp64(a, b) >= 0;
}

/**
 * Convert 64-bit number to decimal string
 */
export function toString64(value: Uint64): string {
  if (value.high === 0) {
    return value.low.toString();
  }

  // For large numbers, we need to do long division
  let result = '';
  let remainder = make64(value.high, value.low);
  const zero = make64(0, 0);

  while (cmp64(remainder, zero) > 0) {
    let digit = 0;
    const temp = make64(remainder.high, remainder.low);

    // Find the largest digit such that digit * 10 <= remainder
    for (let i = 9; i >= 0; i--) {
      const test = from32(i);
      if (gte64(temp, test)) {
        digit = i;
        remainder = sub64(remainder, test);
        break;
      }
    }
    result = digit.toString() + result;

    // This is a simplified approach - for full accuracy we'd need proper division
    // For MUID purposes, we'll use a different approach for string conversion
    break;
  }

  // Fallback: convert using JavaScript's number precision where possible
  if (value.high === 0) {
    return value.low.toString();
  } else if (value.high < 0x200000) { // Safe range for JavaScript numbers
    const num = value.high * 0x100000000 + value.low;
    return num.toString();
  } else {
    // For very large numbers, return hex with prefix
    return '0x' + toHex64(value);
  }
}

/**
 * Convert 64-bit number to hexadecimal string
 */
export function toHex64(value: Uint64): string {
  if (value.high === 0) {
    return value.low.toString(16);
  }
  const highHex = value.high.toString(16);
  let lowHex = value.low.toString(16);
  // Pad low part to 8 characters
  while (lowHex.length < 8) {
    lowHex = '0' + lowHex;
  }
  return highHex + lowHex;
}

/**
 * Convert 64-bit number to base32 string
 */
export function toBase32_64(value: Uint64): string {
  if (value.high === 0) {
    return value.low.toString(32);
  }
  // For simplicity, convert through hex for large numbers
  // In a full implementation, we'd do proper base32 conversion
  const hex = toHex64(value);
  let num = 0;
  let result = '';

  // Convert hex to base32 (simplified approach)
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
  return result || '0';
}

/**
 * Simple hash function for strings (FNV-1a variant)
 */
function hashString(str: string): Uint64 {
  let hash = make64(0x811c9dc5, 0); // FNV offset basis (32-bit)
  const prime = from32(0x01000193); // FNV prime (32-bit)

  for (let i = 0; i < str.length; i++) {
    const char = from32(str.charCodeAt(i));
    hash = and64(or64(hash, char), make64(0, 0xFFFFFFFF)); // XOR and keep 32-bit
    // Simplified multiplication (hash * prime) for 32-bit range
    if (hash.high === 0) {
      hash = from32((hash.low * prime.low) >>> 0);
    }
  }

  return hash;
}

/**
 * Get hostname (Node.js) or generate a stable identifier (browser)
 */
function getMachineIdentifier(): string {
  if (typeof require !== 'undefined') {
    try {
      const os = require('os');
      return os.hostname();
    } catch (e) {
      // Fall through to browser method
    }
  }

  // Browser fallback: use navigator properties or generate random
  if (typeof navigator !== 'undefined') {
    return navigator.userAgent + navigator.platform + (navigator.hardwareConcurrency || '');
  }

  // Final fallback: random string
  return 'js-' + Math.random().toString(36).substring(2);
}

/**
 * Generate random bytes
 */
function getRandomBytes(length: number): number[] {
  const array: number[] = [];

  if (cryptoLib && cryptoLib.getRandomValues) {
    const uintArray = new Uint8Array(length);
    cryptoLib.getRandomValues(uintArray);
    for (let i = 0; i < length; i++) {
      array[i] = uintArray[i];
    }
  } else if (cryptoLib && cryptoLib.randomBytes) {
    // Node.js crypto
    const buffer = cryptoLib.randomBytes(length);
    for (let i = 0; i < length; i++) {
      array[i] = buffer[i];
    }
  } else {
    // Fallback to Math.random (not cryptographically secure)
    for (let i = 0; i < length; i++) {
      array[i] = Math.floor(Math.random() * 256);
    }
  }

  return array;
}

export type Config = {
  machineID?: Uint64;
  timestampBitLen?: number;
  machineIDBitLen?: number;
  epoch?: Uint64;
};

/**
 * Default configuration
 */
export function getDefaultConfig(): Config {
  const config: Config = {
    timestampBitLen: 41,
    machineIDBitLen: 14,
    // epoch default handled in processing
  };

  // For the epoch, we need to handle the full 64-bit value
  // 1700000000000 = 0x18C2F25000 (needs high bits)
  config.epoch = make64(Math.floor(1700000000000 / 0x100000000), 1700000000000 & 0xFFFFFFFF);

  // Calculate machine ID mask - 2^14 - 1 = 16383
  const maxMachineID = (1 << (config.machineIDBitLen || 14)) - 1;

  const identifier = getMachineIdentifier();
  let machineID: Uint64;

  if (identifier) {
    // Hash the identifier and mask to fit
    const hash = hashString(identifier);
    machineID = from32(hash.low & maxMachineID);
  } else {
    // Random fallback
    const randomBytes = getRandomBytes(4);
    let randomValue = 0;
    for (let i = 0; i < 4; i++) {
      randomValue = (randomValue << 8) | randomBytes[i];
    }
    machineID = from32(randomValue & maxMachineID);
  }

  config.machineID = machineID;
  return config;
}

/**
 * MUID class representing a Monotonically Unique ID
 */
export class MUID {
  private value: Uint64;

  constructor(value: Uint64 | number | { high: number, low: number } | undefined) {
    if (typeof value === 'number') {
      this.value = from32(value);
    } else if (value && typeof value.high === 'number' && typeof value.low === 'number') {
      this.value = make64(value.high, value.low);
    } else {
      this.value = make64(0, 0);
    }
  }

  toString(): string {
    return toBase32_64(this.value);
  }

  toHex(): string {
    return toHex64(this.value);
  }

  toDecimal(): string {
    return toString64(this.value);
  }

  valueOf(): Uint64 {
    return this.value;
  }
}

/**
 * Generator class for creating MUIDs
 */
export class Generator {
  private timestampBitLen: number;
  private machineIDBitLen: number;
  private epoch: Uint64;
  private shardIndex: number;
  private shardBitLen: number;
  
  private counterBitLen: number;
  private timestampBitShift: number;
  private machineIDShift: number;
  private shardIndexShift: number;
  private counterBitMask: Uint64;
  private machineID: Uint64;
  private state: Uint64;

  constructor(config: Config, shardIndex = 0, shardBitLen = 0) {
    // Apply defaults
    this.timestampBitLen = config.timestampBitLen || 41;
    this.machineIDBitLen = config.machineIDBitLen || 14;
    this.epoch = config.epoch || make64(Math.floor(1700000000000 / 0x100000000), 1700000000000 & 0xFFFFFFFF);
    this.shardIndex = shardIndex;
    this.shardBitLen = shardBitLen;

    // Calculate bit lengths and shifts
    this.counterBitLen = 64 - this.timestampBitLen - this.machineIDBitLen - this.shardBitLen;

    this.timestampBitShift = this.machineIDBitLen + this.shardBitLen + this.counterBitLen;
    this.machineIDShift = this.shardBitLen + this.counterBitLen;
    this.shardIndexShift = this.counterBitLen;

    // Create counter mask: 2^counterBitLen - 1
    const counterMask = this.counterBitLen >= 32 ?
      make64(0xFFFFFFFF, 0xFFFFFFFF) :
      sub64(shl64(from32(1), this.counterBitLen), from32(1));
    this.counterBitMask = counterMask;

    // Set machine ID and mask it
    let machineID = config.machineID || from32(0);
    const machineIDMask = this.machineIDBitLen >= 32 ?
      make64(0xFFFFFFFF, 0xFFFFFFFF) :
      sub64(shl64(from32(1), this.machineIDBitLen), from32(1));
    this.machineID = and64(machineID, machineIDMask);

    // Mask shard index
    this.shardIndex = (this.shardIndex & ((1 << Math.min(this.shardBitLen, 31)) - 1)) >>> 0;

    // State packs timestamp and counter: [timestamp][counter]
    this.state = from32(1);
  }

  id(): MUID {
    let now = sub64(from32(Date.now() & 0xFFFFFFFF), this.epoch);

    // Handle the high bits of Date.now() for very large timestamps
    const dateNow = Date.now();
    if (dateNow > 0xFFFFFFFF) {
      now = sub64(make64(Math.floor(dateNow / 0x100000000), dateNow & 0xFFFFFFFF), this.epoch);
    }

    // Extract last timestamp and counter from state
    const lastTimestamp = shr64(this.state, this.counterBitLen);
    let counter = and64(this.state, this.counterBitMask);

    // Protect against clock moving backwards
    if (cmp64(now, lastTimestamp) < 0) {
      now = lastTimestamp;
    }

    if (cmp64(now, lastTimestamp) === 0) {
      // Same millisecond as last ID generation
      if (gte64(counter, this.counterBitMask)) {
        // Counter overflow, increment timestamp virtually
        now = add64(now, from32(1));
        counter = from32(1);
      } else {
        counter = add64(counter, from32(1));
      }
    } else {
      // New millisecond, reset counter
      counter = from32(1);
    }

    // Update state
    this.state = or64(shl64(now, this.counterBitLen), counter);

    // Construct the final MUID
    // Structure: [Timestamp][MachineID][ShardIndex][Counter]
    const timestampPart = shl64(now, this.timestampBitShift);
    const machineIDPart = shl64(this.machineID, this.machineIDShift);
    const shardIndexPart = shl64(from32(this.shardIndex), this.shardIndexShift);

    const muid = or64(or64(or64(timestampPart, machineIDPart), shardIndexPart), counter);

    return new MUID(muid);
  }
}

/**
 * Sharded generators for better parallel performance
 */
export class ShardedGenerators {
  private pool: Generator[];
  private size: number;
  private index: number;

  constructor() {
    // Determine number of shards based on CPU cores (or default to 4)
    let numCPU = 4; // Default fallback
    if (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) {
      numCPU = navigator.hardwareConcurrency;
    } else if (typeof require !== 'undefined') {
      try {
        const os = require('os');
        numCPU = os.cpus().length;
      } catch (e) {
        // Keep default
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

    // Create generators for each shard
    for (let i = 0; i < poolSize; i++) {
      this.pool.push(new Generator(defaultConfig, i, shardBits));
    }
  }

  next(): Generator {
    const generator = this.pool[this.index];
    this.index = (this.index + 1) % this.size;
    return generator;
  }
}

// Global sharded generators instance
const defaultShards = new ShardedGenerators();

/**
 * Generate a new MUID using the default sharded generators
 */
export function make(): MUID {
  return defaultShards.next().id();
}

/**
 * Create a new generator with custom configuration
 */
export function newGenerator(config?: Config, shardIndex?: number, shardBitLen?: number): Generator {
  const defaultConfig = getDefaultConfig();
  const mergedConfig: Config = { ...defaultConfig, ...config };
  return new Generator(mergedConfig, shardIndex || 0, shardBitLen || 0);
}
