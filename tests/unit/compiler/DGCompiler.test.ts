import { describe, it, expect } from 'vitest';
import { DGCompiler } from '../../../src/compiler/DGCompiler.js';
import { DGCompileError, DGCycleError, DGLimitError } from '../../../src/errors.js';
import type { DGGraph, DGNode } from '../../../src/types/graph.js';

function node(id: string, inPorts: string[] = [], outPorts: string[] = ['value']): DGNode {
  return {
    id,
    type: 'compute',
    model: 'M',
    ports: {
      in: inPorts.map((n) => ({ name: n, required: true })),
      out: outPorts.map((n) => ({ name: n, required: true })),
    },
    policy: { onError: 'fail', onFailPropagation: 'halt' },
  };
}

function edge(id: string, from: string, fromPort: string, to: string, toPort: string) {
  return { id, from: { node: from, port: fromPort }, to: { node: to, port: toPort } };
}

function validGraph(): DGGraph {
  return {
    id: 'test-graph',
    version: '1.0.0',
    nodes: {
      a: node('a', [], ['value']),
      b: node('b', ['value'], ['result']),
    },
    edges: [edge('e1', 'a', 'value', 'b', 'value')],
  };
}

describe('DGCompiler', () => {
  const compiler = new DGCompiler();

  it('compiles a valid graph successfully', () => {
    const compiled = compiler.compile(validGraph());
    expect(compiled.source).toEqual(validGraph());
    expect(compiled.levels.length).toBeGreaterThan(0);
    expect(compiled.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('produces deterministic hash', () => {
    const c1 = compiler.compile(validGraph());
    const c2 = compiler.compile(validGraph());
    expect(c1.hash).toBe(c2.hash);
  });

  it('populates compiled metadata', () => {
    const compiled = compiler.compile(validGraph());
    expect(compiled.compiled.dgVersion).toBe('0.1.0');
    expect(compiled.compiled.contextEngineVersion).toBe('0.2.0');
    expect(compiled.compiled.coreVersion).toBe('0.2.6');
    expect(compiled.compiled.at).toBeTruthy();
  });

  it('produces correct levels for linear graph', () => {
    const compiled = compiler.compile(validGraph());
    expect(compiled.levels).toHaveLength(2);
    expect(compiled.levels[0]!.nodes).toEqual(['a']);
    expect(compiled.levels[1]!.nodes).toEqual(['b']);
  });

  it('produces wiring map', () => {
    const compiled = compiler.compile(validGraph());
    expect(compiled.wiring.get('b')).toHaveLength(1);
    expect(compiled.wiring.get('b')![0]!.fromNode).toBe('a');
  });

  it('produces failure propagation map', () => {
    const compiled = compiler.compile(validGraph());
    expect(compiled.failures.has('a')).toBe(true);
    expect(compiled.failures.get('a')!.descendants).toContain('b');
  });

  it('rejects graph with invalid identifiers', () => {
    const g: DGGraph = { ...validGraph(), id: 'bad graph!' };
    expect(() => compiler.compile(g)).toThrow(DGCompileError);
  });

  it('rejects graph with cycles', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        a: node('a', ['v'], ['v']),
        b: node('b', ['v'], ['v']),
      },
      edges: [edge('e1', 'a', 'v', 'b', 'v'), edge('e2', 'b', 'v', 'a', 'v')],
    };
    expect(() => compiler.compile(g)).toThrow(DGCycleError);
  });

  it('respects maxNodes limit', () => {
    const nodes: Record<string, DGNode> = {};
    for (let i = 0; i < 10; i++) {
      nodes[`n${i}`] = node(`n${i}`);
    }
    const g: DGGraph = { id: 'g', version: '1', nodes, edges: [] };
    expect(() => compiler.compile(g, { limits: { maxNodes: 5 } })).toThrow(DGLimitError);
  });

  it('collects warnings without throwing in non-strict mode', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        a: node('a', [], ['v']),
        b: node('b', ['v'], []),
      },
      edges: [
        {
          id: 'e1',
          from: { node: 'a', port: 'v' },
          to: { node: 'b', port: 'v' },
          condition: {
            dsl: 'jsonlogic',
            expression: { '>': [{ var: 'mystery' }, 0] },
            scope: 'full-context',
          },
        },
      ],
    };
    const compiled = compiler.compile(g);
    expect(compiled.warnings.length).toBeGreaterThan(0);
  });
});
