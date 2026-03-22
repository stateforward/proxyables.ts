# Proxyables (TypeScript)

A high-performance, peer-to-peer RPC library that makes remote objects feel local. Built on top of **Yamux** multiplexing and JavaScript **Proxies**, it enables seamless bi-directional interaction between processes with support for callbacks, distributed garbage collection, and complex argument hydration.

## Features

- **Peer-to-Peer Architecture**: No strict client/server distinction. both sides can import and export objects, enabling true bi-directional communication.
- **"Local-Feeling" API**: Intercepts all operations (get, set, apply, construct) using recursive Proxies.
- **Distributed Garbage Collection**: Automatically manages remote object lifecycles using `FinalizationRegistry` and a robust reference counting protocol.
- **Bi-Directional Callbacks**: Pass functions and objects as arguments. They are automatically registered and hydrated as proxies on the other side.
- **High Performance**:
  - **MUID (Monotonically Unique ID)**: Uses a custom 64-bit ID generator (ported from Go) that is significantly faster than UUID/ULID, reducing RPC latency by up to ~80%.
  - **Stream Pooling**: Reuses Yamux substreams to eliminate handshake overhead for high-frequency calls.

## Performance

Proxyables is optimized for low-latency, high-throughput IPC.

| Metric | Performance |
| :--- | :--- |
| **Throughput** | ~27,000 ops/sec (M1 Pro) |
| **Latency** | ~0.036ms per call |
| **Stream Pooling** | ~3% improvement for small payloads |

*Benchmark data based on `callNoArgs` operations on darwin-arm64.*

## Primitives

### MUID (Monotonically Unique ID)
We replaced standard ULID calls with a custom **MUID** implementation (`src/muid.ts`). This provides 64-bit unique IDs comprising a timestamp, machine ID, and counter. This shift alone resulted in a **4x - 6x improvement** in throughput by removing the bottleneck of string-based ID generation in hot paths.

### Stream Pooling
To mitigate the overhead of opening new Yamux streams (SYN packets) for every single property access, we implement a `StreamPool`. It maintains a set of idle `Duplex` streams that are reused for subsequent requests, significantly reducing allocation latency.

## Installation

```bash
npm install proxyables
# or
bun add proxyables
```

## Usage

### Basic Example

**Server (Exporting an object):**
```typescript
import { createExportedProxyable } from 'proxyables';
// import { Duplex } from 'stream'; 

const api = {
  echo: (msg: string) => `echo ${msg}`,
  compute: (a: number, b: number) => a + b,
};

// You just need a Duplex stream (e.g., TCP socket, WebSocket stream, etc.)
// const stream = ...; 

const exported = createExportedProxyable({ 
  object: api, 
  stream 
});
```

**Client (Importing the object):**
```typescript
import { createImportedProxyable } from 'proxyables';

// const stream = ...;

const proxy = createImportedProxyable({ stream });

// Usage - feels completely local!
console.log(await proxy.echo("hello")); // "echo hello"
console.log(await proxy.compute(10, 20)); // 30
```

### Passing Callbacks (Bi-directional)

```typescript
// Client
await proxy.onRemoteEvent((data) => {
  console.log("Received data from server:", data);
});
```
The callback function is automatically registered, assigned an ID, and a proxy reference is sent to the server. When the server calls it, it opens a reverse stream to execute the client-side function.

## Architecture

1.  **Proxy Layer**: Wraps local objects and creates "Cursor" proxies for remote ones.
2.  **Instruction Protocol**: Operations (get, apply, etc.) are serialized into `ProxyInstructions` using `@msgpack/msgpack`.
3.  **Transport**: Uses `yamux-js` to multiplex concurrent operations over a single connection (TCP, WebSocket, stdio, etc.).
4.  **Reference Management**: A shared `ObjectRegistry` tracks local objects passed by reference. `FinalizationRegistry` detects when a remote proxy is unused and sends `release` instructions to free memory.
