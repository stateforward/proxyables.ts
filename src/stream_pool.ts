import { Duplex } from "stream";

type SessionLike = {
  open: () => Duplex;
};

type StreamPoolOptions = {
  session: SessionLike;
  max: number;
  reuse?: boolean;
};

type PendingRequest = (stream: Duplex) => void;

export class StreamPool {
  private session: SessionLike;
  private max: number;
  private openCount = 0;
  private idle: Duplex[] = [];
  private idleSet = new Set<Duplex>();
  private pending: PendingRequest[] = [];
  private reuse: boolean;

  constructor({ session, max, reuse = true }: StreamPoolOptions) {
    this.session = session;
    this.max = Math.max(1, max);
    this.reuse = reuse;
  }

  async acquire(): Promise<Duplex> {
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

  release(stream: Duplex) {
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

  private createStream(): Duplex {
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

  private cleanupStream(stream: Duplex) {
    if (this.idleSet.delete(stream)) {
      this.idle = this.idle.filter((item) => item !== stream);
    }
    this.openCount = Math.max(0, this.openCount - 1);
  }

  private isClosed(stream: Duplex) {
    return (
      stream.destroyed ||
      (stream.readableEnded && stream.writableEnded)
    );
  }
}
