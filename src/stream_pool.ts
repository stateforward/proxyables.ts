import type { Stream } from "@stateforward/yamux.ts";

type SessionLike = {
  openStream: () => Promise<Stream>;
};

type StreamPoolOptions = {
  session: SessionLike;
  max: number;
  reuse?: boolean;
};

type PendingRequest = (stream: Stream) => void;

export class StreamPool {
  private session: SessionLike;
  private max: number;
  private openCount = 0;
  private idle: Stream[] = [];
  private idleSet = new Set<Stream>();
  private pending: PendingRequest[] = [];
  private reuse: boolean;

  constructor({ session, max, reuse = true }: StreamPoolOptions) {
    this.session = session;
    this.max = Math.max(1, max);
    this.reuse = reuse;
  }

  async acquire(): Promise<Stream> {
    for (;;) {
      const stream = this.idle.pop();
      if (!stream) break;
      this.idleSet.delete(stream);
      if (!this.isClosed(stream)) {
        return stream;
      }
      this.cleanupStream(stream);
    }
    if (this.openCount < this.max) {
      return await this.createStream();
    }
    return new Promise((resolve) => this.pending.push(resolve));
  }

  release(stream: Stream) {
    if (this.isClosed(stream)) {
      this.cleanupStream(stream);
      return;
    }
    const waiter = this.pending.shift();
    if (waiter) {
      waiter(stream);
      return;
    }
    if (!this.reuse) {
      void stream.reset();
      this.cleanupStream(stream);
      return;
    }
    this.idle.push(stream);
    this.idleSet.add(stream);
  }

  private async createStream(): Promise<Stream> {
    this.openCount += 1;
    try {
      return await this.session.openStream();
    } catch (error) {
      this.openCount = Math.max(0, this.openCount - 1);
      throw error;
    }
  }

  private cleanupStream(stream: Stream) {
    if (this.idleSet.delete(stream)) {
      this.idle = this.idle.filter((item) => item !== stream);
    }
    this.openCount = Math.max(0, this.openCount - 1);
    if (this.pending.length && this.openCount < this.max) {
      const waiter = this.pending.shift();
      if (waiter) void this.createStream().then(waiter);
    }
  }

  private isClosed(stream: Stream) {
    return stream.closed || Boolean(stream.resetError);
  }
}
