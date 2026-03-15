// src/codebase/rag/taskQueue.ts

// ════════════════════════════════════════════════════════════════════════════
//  Concurrency‑limited task queue
// ════════════════════════════════════════════════════════════════════════════

export class TaskQueue {
  private readonly max: number;
  private running = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(concurrency: number) {
    this.max = concurrency;
  }

  add<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const execute = async () => {
        this.running++;
        try {
          resolve(await fn());
        } catch (e) {
          reject(e);
        } finally {
          this.running--;
          if (this.waiting.length > 0 && this.running < this.max) {
            this.waiting.shift()!();
          }
        }
      };
      if (this.running < this.max) {
        execute();
      } else {
        this.waiting.push(execute);
      }
    });
  }
}
