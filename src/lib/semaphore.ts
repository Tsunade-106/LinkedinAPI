import { AppError } from "../domain/errors.js";

interface Waiter {
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class Semaphore {
  private active = 0;
  private readonly queue: Waiter[] = [];

  public constructor(
    private readonly capacity: number,
    private readonly maxQueue = Number.POSITIVE_INFINITY
  ) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error("Semaphore capacity must be a positive integer");
    }
    if ((!Number.isInteger(maxQueue) && maxQueue !== Number.POSITIVE_INFINITY) || maxQueue < 0) {
      throw new Error("Semaphore maximum queue length must be a non-negative integer");
    }
  }

  public acquire(waitTimeoutMs: number): Promise<() => void> {
    if (this.active < this.capacity) {
      this.active += 1;
      return Promise.resolve(this.createRelease());
    }
    if (this.queue.length >= this.maxQueue) {
      return Promise.reject(capacityError());
    }

    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          const index = this.queue.indexOf(waiter);
          if (index >= 0) this.queue.splice(index, 1);
          reject(capacityError());
        }, waitTimeoutMs)
      };
      this.queue.push(waiter);
    });
  }

  public get activeCount(): number {
    return this.active;
  }

  public get queuedCount(): number {
    return this.queue.length;
  }

  private createRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.queue.shift();
      if (next) {
        clearTimeout(next.timer);
        next.resolve(this.createRelease());
      } else {
        this.active -= 1;
      }
    };
  }
}

function capacityError(): AppError {
  return new AppError(
    "SCRAPE_CAPACITY_EXCEEDED",
    "Scraping capacity is currently full; retry later",
    503,
    true
  );
}
