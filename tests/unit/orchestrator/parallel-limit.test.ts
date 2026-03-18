import { describe, it, expect } from 'vitest';
import { parallelWithLimit } from '../../../src/orchestrator/parallelWithLimit.js';

describe('parallelWithLimit', () => {
  it('returns empty for no tasks', async () => {
    const result = await parallelWithLimit([], 5);
    expect(result).toEqual([]);
  });

  it('executes all tasks and returns results in order', async () => {
    const tasks = [() => Promise.resolve(1), () => Promise.resolve(2), () => Promise.resolve(3)];
    const result = await parallelWithLimit(tasks, 10);
    expect(result).toEqual([1, 2, 3]);
  });

  it('respects concurrency limit', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;

    const makeTask = (value: number) => async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 20));
      concurrent--;
      return value;
    };

    const tasks = [makeTask(1), makeTask(2), makeTask(3), makeTask(4), makeTask(5)];
    const result = await parallelWithLimit(tasks, 2);

    expect(result).toEqual([1, 2, 3, 4, 5]);
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it('handles single task', async () => {
    const result = await parallelWithLimit([() => Promise.resolve(42)], 5);
    expect(result).toEqual([42]);
  });

  it('handles limit of 1 (sequential)', async () => {
    const order: number[] = [];
    const makeTask = (value: number) => async () => {
      order.push(value);
      return value;
    };

    const tasks = [makeTask(1), makeTask(2), makeTask(3)];
    await parallelWithLimit(tasks, 1);
    expect(order).toEqual([1, 2, 3]);
  });

  it('propagates errors', async () => {
    const tasks = [
      () => Promise.resolve(1),
      () => Promise.reject(new Error('boom')),
      () => Promise.resolve(3),
    ];
    await expect(parallelWithLimit(tasks, 2)).rejects.toThrow('boom');
  });

  it('limit larger than task count works', async () => {
    const tasks = [() => Promise.resolve('a'), () => Promise.resolve('b')];
    const result = await parallelWithLimit(tasks, 100);
    expect(result).toEqual(['a', 'b']);
  });
});
