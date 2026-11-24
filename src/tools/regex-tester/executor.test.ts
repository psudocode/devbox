// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { TIMEOUT_MESSAGE, createRegexExecutor } from "./executor";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const job = { pattern: "a+", flags: "g", text: "caat", replacement: null };

describe("createRegexExecutor without Worker support", () => {
  it("falls back to running inline", async () => {
    vi.stubGlobal("Worker", undefined);
    const executor = createRegexExecutor();
    const result = await executor.run(job);
    expect(result).toMatchObject({ ok: true, outcome: { matches: [{ text: "aa", index: 1 }] } });
    executor.dispose();
  });
});

/** Minimal fake Worker so the protocol and timeout handling can be tested in jsdom. */
class FakeWorker {
  static instances: FakeWorker[] = [];
  /** When false the worker never answers (simulates a stuck regex). */
  static respond = true;
  terminated = false;
  private listeners: Record<string, ((e: unknown) => void)[]> = {};

  constructor() {
    FakeWorker.instances.push(this);
  }
  addEventListener(type: string, fn: (e: unknown) => void) {
    (this.listeners[type] ??= []).push(fn);
  }
  postMessage(data: { id: number }) {
    if (FakeWorker.respond) {
      queueMicrotask(() =>
        this.listeners.message?.forEach((fn) => fn({ data: { id: data.id, result: { ok: true, outcome: { matches: [], truncated: false, replaced: null } } } })),
      );
    }
  }
  fail() {
    this.listeners.error?.forEach((fn) => fn({}));
  }
  terminate() {
    this.terminated = true;
  }
}

describe("createRegexExecutor with a worker", () => {
  const setup = () => {
    FakeWorker.instances = [];
    FakeWorker.respond = true;
    vi.stubGlobal("Worker", FakeWorker);
  };

  it("returns the worker's answer and reuses one worker", async () => {
    setup();
    const executor = createRegexExecutor();
    expect(await executor.run(job)).toMatchObject({ ok: true });
    expect(await executor.run(job)).toMatchObject({ ok: true });
    expect(FakeWorker.instances).toHaveLength(1);
    executor.dispose();
    expect(FakeWorker.instances[0].terminated).toBe(true);
  });

  it("kills a stuck worker on timeout and starts a fresh one next time", async () => {
    setup();
    vi.useFakeTimers();
    const executor = createRegexExecutor(1000);
    FakeWorker.respond = false;
    const stuck = executor.run(job);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await stuck).toEqual({ ok: false, error: TIMEOUT_MESSAGE });
    expect(FakeWorker.instances[0].terminated).toBe(true);

    FakeWorker.respond = true;
    const next = executor.run(job);
    await vi.advanceTimersByTimeAsync(0);
    expect(await next).toMatchObject({ ok: true });
    expect(FakeWorker.instances).toHaveLength(2);
    executor.dispose();
  });

  it("supersedes an older job with null", async () => {
    setup();
    const executor = createRegexExecutor();
    FakeWorker.respond = false;
    const first = executor.run(job);
    FakeWorker.respond = true;
    const second = executor.run({ ...job, pattern: "b" });
    expect(await first).toBeNull();
    expect(await second).toMatchObject({ ok: true });
    executor.dispose();
  });

  it("reports a crashed worker and recovers", async () => {
    setup();
    const executor = createRegexExecutor();
    FakeWorker.respond = false;
    const crashed = executor.run(job);
    FakeWorker.instances[0].fail();
    expect(await crashed).toEqual({ ok: false, error: "The regex worker failed to run." });
    FakeWorker.respond = true;
    expect(await executor.run(job)).toMatchObject({ ok: true });
    expect(FakeWorker.instances).toHaveLength(2);
    executor.dispose();
  });
});
