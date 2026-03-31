import { describe, expect, test } from 'bun:test';

import { CommandScheduler } from '../background/command-scheduler';

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(rounds: number = 3): Promise<void> {
  for (let round = 0; round < rounds; round += 1) {
    await Promise.resolve();
  }
}

describe('CommandScheduler', () => {
  test('runs different conversations concurrently up to the global limit', async () => {
    const started: string[] = [];
    const gates = new Map<string, ReturnType<typeof createDeferred<void>>>();

    const scheduler = new CommandScheduler<
      { id: string; conversation_id: string },
      string
    >({
      maxConcurrentCommands: 2,
      maxConcurrentHeavyCommands: 2,
      processCommand: async (data) => {
        started.push(data.id);
        const gate = createDeferred<void>();
        gates.set(data.id, gate);
        await gate.promise;
        return data.id;
      },
    });

    const first = scheduler.enqueue({ id: 'a1', conversation_id: 'conv-a' });
    const second = scheduler.enqueue({ id: 'b1', conversation_id: 'conv-b' });
    const third = scheduler.enqueue({ id: 'c1', conversation_id: 'conv-c' });

    await flushMicrotasks();
    expect(started).toEqual(['a1', 'b1']);

    gates.get('a1')?.resolve();
    await flushMicrotasks();
    expect(started).toEqual(['a1', 'b1', 'c1']);

    gates.get('b1')?.resolve();
    gates.get('c1')?.resolve();

    await expect(first).resolves.toBe('a1');
    await expect(second).resolves.toBe('b1');
    await expect(third).resolves.toBe('c1');
  });

  test('keeps commands from the same conversation serialized', async () => {
    const started: string[] = [];
    const gates = new Map<string, ReturnType<typeof createDeferred<void>>>();

    const scheduler = new CommandScheduler<
      { id: string; conversation_id: string },
      string
    >({
      maxConcurrentCommands: 3,
      maxConcurrentHeavyCommands: 2,
      processCommand: async (data) => {
        started.push(data.id);
        const gate = createDeferred<void>();
        gates.set(data.id, gate);
        await gate.promise;
        return data.id;
      },
    });

    const first = scheduler.enqueue({ id: 'a1', conversation_id: 'conv-a' });
    const second = scheduler.enqueue({ id: 'a2', conversation_id: 'conv-a' });
    const third = scheduler.enqueue({ id: 'b1', conversation_id: 'conv-b' });

    await flushMicrotasks();
    expect(started).toEqual(['a1', 'b1']);

    gates.get('b1')?.resolve();
    await flushMicrotasks();
    expect(started).toEqual(['a1', 'b1']);

    gates.get('a1')?.resolve();
    await flushMicrotasks();
    expect(started).toEqual(['a1', 'b1', 'a2']);

    gates.get('a2')?.resolve();

    await expect(first).resolves.toBe('a1');
    await expect(second).resolves.toBe('a2');
    await expect(third).resolves.toBe('b1');
  });

  test('limits heavy commands separately from overall concurrency', async () => {
    const started: string[] = [];
    const gates = new Map<string, ReturnType<typeof createDeferred<void>>>();

    const scheduler = new CommandScheduler<
      { id: string; conversation_id: string; heavy?: boolean },
      string
    >({
      maxConcurrentCommands: 3,
      maxConcurrentHeavyCommands: 1,
      isHeavyCommand: (data) => data.heavy === true,
      processCommand: async (data) => {
        started.push(data.id);
        const gate = createDeferred<void>();
        gates.set(data.id, gate);
        await gate.promise;
        return data.id;
      },
    });

    const heavyA = scheduler.enqueue({
      id: 'heavy-a',
      conversation_id: 'conv-a',
      heavy: true,
    });
    const heavyB = scheduler.enqueue({
      id: 'heavy-b',
      conversation_id: 'conv-b',
      heavy: true,
    });
    const lightC = scheduler.enqueue({
      id: 'light-c',
      conversation_id: 'conv-c',
      heavy: false,
    });

    await flushMicrotasks();
    expect(started).toEqual(['heavy-a', 'light-c']);

    gates.get('light-c')?.resolve();
    await flushMicrotasks();
    expect(started).toEqual(['heavy-a', 'light-c']);

    gates.get('heavy-a')?.resolve();
    await flushMicrotasks();
    expect(started).toEqual(['heavy-a', 'light-c', 'heavy-b']);

    gates.get('heavy-b')?.resolve();

    await expect(heavyA).resolves.toBe('heavy-a');
    await expect(heavyB).resolves.toBe('heavy-b');
    await expect(lightC).resolves.toBe('light-c');
  });
});
