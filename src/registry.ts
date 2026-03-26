import { make as muid } from "./muid";

export type ObjectRegistrySnapshot = {
  entries: number;
  retains: number;
};

export class ObjectRegistry {
  private map = new Map<string, object>();
  private counts = new Map<string, number>();
  private weakMap = new WeakMap<object, string>();

  register(object: object): string {
    const existingId = this.weakMap.get(object);
    if (existingId) {
        const count = this.counts.get(existingId) ?? 0;
        this.counts.set(existingId, count + 1);
        return existingId;
    }

    const id = muid().toString();
    this.map.set(id, object);
    this.counts.set(id, 1);
    this.weakMap.set(object, id);
    return id;
  }

  get(id: string): object | undefined {
    return this.map.get(id);
  }

  delete(id: string) {
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

  snapshot(): ObjectRegistrySnapshot {
    let retains = 0;
    for (const count of this.counts.values()) {
      retains += count;
    }
    return {
      entries: this.map.size,
      retains,
    };
  }

  debug() {
      return Array.from(this.map.entries()).map(([id, obj]) => ({ id, type: typeof obj, obj }));
  }
}
