import { describe, it, expect, vi } from 'vitest';
import { CompositeExecutor } from '../../../src/executor/CompositeExecutor.js';
import type { NodeExecutor, NodeResult } from '../../../src/executor/NodeExecutor.js';
import type { DGNode } from '../../../src/types/graph.js';
import type { ExecutionMeta } from '@run-iq/context-engine';

const META: ExecutionMeta = {
  requestId: 'req-1',
  tenantId: 'tenant-1',
  timestamp: new Date().toISOString(),
};

function makeResult(tag: string): NodeResult {
  return { outputs: { tag }, durationMs: 1 };
}

function makeNode(type: DGNode['type'], id = 'n'): DGNode {
  return {
    id,
    type,
    model: type === 'compute' ? 'M' : undefined,
    ports: { in: [], out: [] },
    policy: { onError: 'fail', onFailPropagation: 'halt' },
  };
}

describe('CompositeExecutor', () => {
  it('routes enrich nodes to httpExecutor', async () => {
    const core: NodeExecutor = { execute: vi.fn().mockResolvedValue(makeResult('core')) };
    const http: NodeExecutor = { execute: vi.fn().mockResolvedValue(makeResult('http')) };
    const composite = new CompositeExecutor(core, http);

    const result = await composite.execute(makeNode('enrich'), {}, META);

    expect(http.execute).toHaveBeenCalledTimes(1);
    expect(core.execute).not.toHaveBeenCalled();
    expect(result.outputs['tag']).toBe('http');
  });

  it('routes compute nodes to coreExecutor', async () => {
    const core: NodeExecutor = { execute: vi.fn().mockResolvedValue(makeResult('core')) };
    const http: NodeExecutor = { execute: vi.fn().mockResolvedValue(makeResult('http')) };
    const composite = new CompositeExecutor(core, http);

    const result = await composite.execute(makeNode('compute'), {}, META);

    expect(core.execute).toHaveBeenCalledTimes(1);
    expect(http.execute).not.toHaveBeenCalled();
    expect(result.outputs['tag']).toBe('core');
  });

  it('routes branch nodes to coreExecutor', async () => {
    const core: NodeExecutor = { execute: vi.fn().mockResolvedValue(makeResult('core')) };
    const http: NodeExecutor = { execute: vi.fn().mockResolvedValue(makeResult('http')) };
    const composite = new CompositeExecutor(core, http);

    await composite.execute(makeNode('branch'), {}, META);

    expect(core.execute).toHaveBeenCalledTimes(1);
    expect(http.execute).not.toHaveBeenCalled();
  });

  it('routes guard nodes to coreExecutor', async () => {
    const core: NodeExecutor = { execute: vi.fn().mockResolvedValue(makeResult('core')) };
    const http: NodeExecutor = { execute: vi.fn().mockResolvedValue(makeResult('http')) };
    const composite = new CompositeExecutor(core, http);

    await composite.execute(makeNode('guard'), {}, META);

    expect(core.execute).toHaveBeenCalledTimes(1);
    expect(http.execute).not.toHaveBeenCalled();
  });

  it('routes merge nodes to coreExecutor', async () => {
    const core: NodeExecutor = { execute: vi.fn().mockResolvedValue(makeResult('core')) };
    const http: NodeExecutor = { execute: vi.fn().mockResolvedValue(makeResult('http')) };
    const composite = new CompositeExecutor(core, http);

    await composite.execute(makeNode('merge'), {}, META);

    expect(core.execute).toHaveBeenCalledTimes(1);
    expect(http.execute).not.toHaveBeenCalled();
  });

  it('passes node, inputs, and meta through to the delegate', async () => {
    const core: NodeExecutor = { execute: vi.fn().mockResolvedValue(makeResult('core')) };
    const http: NodeExecutor = { execute: vi.fn().mockResolvedValue(makeResult('http')) };
    const composite = new CompositeExecutor(core, http);

    const node = makeNode('enrich');
    const inputs = { foo: 'bar' };
    await composite.execute(node, inputs, META);

    expect(http.execute).toHaveBeenCalledWith(node, inputs, META);
  });

  // --- Subgraph routing ---

  it('routes subgraph nodes to subGraphExecutor', async () => {
    const core: NodeExecutor = { execute: vi.fn().mockResolvedValue(makeResult('core')) };
    const http: NodeExecutor = { execute: vi.fn().mockResolvedValue(makeResult('http')) };
    const sg: NodeExecutor = { execute: vi.fn().mockResolvedValue(makeResult('subgraph')) };
    const composite = new CompositeExecutor(core, http, sg);

    const result = await composite.execute(makeNode('subgraph'), {}, META);

    expect(sg.execute).toHaveBeenCalledTimes(1);
    expect(core.execute).not.toHaveBeenCalled();
    expect(http.execute).not.toHaveBeenCalled();
    expect(result.outputs['tag']).toBe('subgraph');
  });

  it('throws when subgraph node but no subGraphExecutor provided', async () => {
    const core: NodeExecutor = { execute: vi.fn().mockResolvedValue(makeResult('core')) };
    const http: NodeExecutor = { execute: vi.fn().mockResolvedValue(makeResult('http')) };
    const composite = new CompositeExecutor(core, http);

    await expect(composite.execute(makeNode('subgraph'), {}, META)).rejects.toThrow(
      'no SubGraphExecutor was provided',
    );
  });
});
