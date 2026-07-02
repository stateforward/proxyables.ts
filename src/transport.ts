import type {
  ClientOptions,
  ServerOptions,
  Session,
  Stream,
} from "@stateforward/yamux.ts";
import type { ProxyInstruction, ProxyInstructionDecoder } from "./types";

export type ProxyableClientTransport = ClientOptions;
export type ProxyableServerTransport = ServerOptions;
export type ProxyableSession = Session;
export type ProxyableStream = Stream;

export function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(left.byteLength + right.byteLength);
  bytes.set(left);
  bytes.set(right, left.byteLength);
  return bytes;
}

export function tryDecodeInstruction(
  decoder: ProxyInstructionDecoder["decode"],
  data: Uint8Array,
  kinds: number[]
): ProxyInstruction | null {
  try {
    const [error, instruction] = decoder(data, kinds as any);
    if (error) return null;
    return instruction as ProxyInstruction;
  } catch {
    return null;
  }
}

export async function writeToStream(
  stream: Stream,
  data: Uint8Array
): Promise<void> {
  const writer = stream.writable.getWriter();
  try {
    await writer.write(data);
  } finally {
    writer.releaseLock();
  }
}

export async function readFromStream(
  stream: Stream
): Promise<Uint8Array | null> {
  const reader = stream.readable.getReader();
  try {
    const { value, done } = await reader.read();
    return done ? null : value;
  } finally {
    reader.releaseLock();
  }
}

export async function readInstructionFromStream(
  stream: Stream,
  decoder: ProxyInstructionDecoder["decode"],
  kinds: number[]
): Promise<ProxyInstruction | null> {
  const reader = stream.readable.getReader();
  let buffer = new Uint8Array();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return null;
      if (!value) continue;
      buffer = concatBytes(buffer, value);
      const instruction = tryDecodeInstruction(decoder, buffer, kinds);
      if (instruction) return instruction;
    }
  } finally {
    reader.releaseLock();
  }
}

export async function readEachStreamChunk(
  stream: Stream,
  onChunk: (chunk: Uint8Array) => Promise<void> | void
): Promise<void> {
  const reader = stream.readable.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      if (value) await onChunk(value);
    }
  } finally {
    reader.releaseLock();
  }
}
