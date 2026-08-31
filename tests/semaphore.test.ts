import { describe, expect, it } from "vitest";
import type { AppError } from "../src/domain/errors.js";
import { Semaphore } from "../src/lib/semaphore.js";

describe("Semaphore", () => {
  it("rejects invalid capacity", () => {
    expect(() => new Semaphore(0)).toThrow(/positive integer/);
    expect(() => new Semaphore(1, -1)).toThrow(/queue length/);
  });

  it("rejects immediately when the bounded queue is full", async () => {
    const semaphore = new Semaphore(1, 0);
    const release = await semaphore.acquire(100);
    await expect(semaphore.acquire(100)).rejects.toMatchObject({ code: "SCRAPE_CAPACITY_EXCEEDED" });
    release();
  });

  it("bounds concurrency, promotes queued work, and makes release idempotent", async () => {
    const semaphore = new Semaphore(1);
    const firstRelease = await semaphore.acquire(100);
    const second = semaphore.acquire(100);

    expect(semaphore.activeCount).toBe(1);
    expect(semaphore.queuedCount).toBe(1);
    firstRelease();
    const secondRelease = await second;
    expect(semaphore.activeCount).toBe(1);
    expect(semaphore.queuedCount).toBe(0);
    secondRelease();
    secondRelease();
    expect(semaphore.activeCount).toBe(0);
  });

  it("removes work that waits beyond its deadline", async () => {
    const semaphore = new Semaphore(1);
    const release = await semaphore.acquire(100);
    await expect(semaphore.acquire(5)).rejects.toMatchObject({ code: "SCRAPE_CAPACITY_EXCEEDED" } satisfies Partial<AppError>);
    expect(semaphore.queuedCount).toBe(0);
    release();
  });
});
