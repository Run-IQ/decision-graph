import { describe, it, expect } from 'vitest';
import { analyzeDSLVariables } from '../../../src/compiler/steps/step8-dsl-vars.js';
import { DGCompileError } from '../../../src/errors.js';
import type { DGGraph, DGNode } from '../../../src/types/graph.js';
import type { ExecutionLevel } from '../../../src/types/compiled.js';

function node(id: string, inPorts: string[] = [], outPorts: string[] = []): DGNode {
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

describe('step8-dsl-vars', () => {
  it('returns empty map when no edges have conditions', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: node('a', [], ['v']), b: node('b', ['v'], []) },
      edges: [{ id: 'e1', from: { node: 'a', port: 'v' }, to: { node: 'b', port: 'v' } }],
    };
    const levels: ExecutionLevel[] = [
      { index: 0, nodes: ['a'], mergeNodes: [] },
      { index: 1, nodes: ['b'], mergeNodes: [] },
    ];
    const { dslVars } = analyzeDSLVariables(g, levels);
    expect(dslVars.size).toBe(0);
  });

  it('extracts var references from JSONLogic expression', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: node('a', [], ['tax']), b: node('b', ['tax'], []) },
      edges: [
        {
          id: 'e1',
          from: { node: 'a', port: 'tax' },
          to: { node: 'b', port: 'tax' },
          condition: {
            dsl: 'jsonlogic',
            expression: { '>': [{ var: 'a.tax' }, 0] },
            scope: 'full-context',
          },
        },
      ],
    };
    const levels: ExecutionLevel[] = [
      { index: 0, nodes: ['a'], mergeNodes: [] },
      { index: 1, nodes: ['b'], mergeNodes: [] },
    ];
    const { dslVars } = analyzeDSLVariables(g, levels);
    expect(dslVars.get('e1')!.referencedVars).toContain('a.tax');
  });

  it('resolves variable producer and level', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: node('a', [], ['tax']), b: node('b', ['tax'], []) },
      edges: [
        {
          id: 'e1',
          from: { node: 'a', port: 'tax' },
          to: { node: 'b', port: 'tax' },
          condition: {
            dsl: 'jsonlogic',
            expression: { '>': [{ var: 'a.tax' }, 0] },
            scope: 'full-context',
          },
        },
      ],
    };
    const levels: ExecutionLevel[] = [
      { index: 0, nodes: ['a'], mergeNodes: [] },
      { index: 1, nodes: ['b'], mergeNodes: [] },
    ];
    const { dslVars } = analyzeDSLVariables(g, levels);
    const resolved = dslVars.get('e1')!.resolvedVars;
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.producerNode).toBe('a');
    expect(resolved[0]!.producerLevel).toBe(0);
    expect(resolved[0]!.destinationLevel).toBe(1);
    expect(resolved[0]!.valid).toBe(true);
  });

  it('throws on same-level variable (race condition)', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        a: node('a', [], ['v']),
        b: node('b', [], ['w']),
      },
      edges: [
        {
          id: 'e1',
          from: { node: 'a', port: 'v' },
          to: { node: 'b', port: 'v' },
          condition: {
            dsl: 'jsonlogic',
            expression: { '>': [{ var: 'b.w' }, 0] },
            scope: 'full-context',
          },
        },
      ],
    };
    // Both at level 0
    const levels: ExecutionLevel[] = [{ index: 0, nodes: ['a', 'b'], mergeNodes: [] }];
    expect(() => analyzeDSLVariables(g, levels)).toThrow(DGCompileError);
  });

  it('warns on undeclared variable', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: node('a', [], ['v']), b: node('b', ['v'], []) },
      edges: [
        {
          id: 'e1',
          from: { node: 'a', port: 'v' },
          to: { node: 'b', port: 'v' },
          condition: {
            dsl: 'jsonlogic',
            expression: { '>': [{ var: 'unknown_var' }, 0] },
            scope: 'full-context',
          },
        },
      ],
    };
    const levels: ExecutionLevel[] = [
      { index: 0, nodes: ['a'], mergeNodes: [] },
      { index: 1, nodes: ['b'], mergeNodes: [] },
    ];
    const { dslVars, warnings } = analyzeDSLVariables(g, levels);
    expect(dslVars.get('e1')!.undeclaredVars).toContain('unknown_var');
    expect(warnings.length).toBeGreaterThanOrEqual(1);
  });

  it('handles multiple var references in one expression', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: node('a', [], ['x', 'y']), b: node('b', ['x'], []) },
      edges: [
        {
          id: 'e1',
          from: { node: 'a', port: 'x' },
          to: { node: 'b', port: 'x' },
          condition: {
            dsl: 'jsonlogic',
            expression: { and: [{ '>': [{ var: 'a.x' }, 0] }, { '<': [{ var: 'a.y' }, 100] }] },
            scope: 'full-context',
          },
        },
      ],
    };
    const levels: ExecutionLevel[] = [
      { index: 0, nodes: ['a'], mergeNodes: [] },
      { index: 1, nodes: ['b'], mergeNodes: [] },
    ];
    const { dslVars } = analyzeDSLVariables(g, levels);
    expect(dslVars.get('e1')!.referencedVars).toEqual(['a.x', 'a.y']);
  });

  it('handles condition with no var references', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: node('a', [], ['v']), b: node('b', ['v'], []) },
      edges: [
        {
          id: 'e1',
          from: { node: 'a', port: 'v' },
          to: { node: 'b', port: 'v' },
          condition: { dsl: 'jsonlogic', expression: true, scope: 'full-context' },
        },
      ],
    };
    const levels: ExecutionLevel[] = [
      { index: 0, nodes: ['a'], mergeNodes: [] },
      { index: 1, nodes: ['b'], mergeNodes: [] },
    ];
    const { dslVars } = analyzeDSLVariables(g, levels);
    expect(dslVars.get('e1')!.referencedVars).toEqual([]);
  });

  it('source-output scope resolves port name directly', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: node('a', [], ['tax']), b: node('b', ['tax'], []) },
      edges: [
        {
          id: 'e1',
          from: { node: 'a', port: 'tax' },
          to: { node: 'b', port: 'tax' },
          condition: {
            dsl: 'jsonlogic',
            expression: { '>': [{ var: 'tax' }, 0] },
            scope: 'source-output',
          },
        },
      ],
    };
    const levels: ExecutionLevel[] = [
      { index: 0, nodes: ['a'], mergeNodes: [] },
      { index: 1, nodes: ['b'], mergeNodes: [] },
    ];
    const { dslVars } = analyzeDSLVariables(g, levels);
    const resolved = dslVars.get('e1')!.resolvedVars;
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.producerNode).toBe('a');
    expect(resolved[0]!.valid).toBe(true);
  });

  it('handles nested JSONLogic expressions', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: node('a', [], ['v']), b: node('b', ['v'], []) },
      edges: [
        {
          id: 'e1',
          from: { node: 'a', port: 'v' },
          to: { node: 'b', port: 'v' },
          condition: {
            dsl: 'jsonlogic',
            expression: { if: [{ '>': [{ var: 'a.v' }, 10] }, true, false] },
            scope: 'full-context',
          },
        },
      ],
    };
    const levels: ExecutionLevel[] = [
      { index: 0, nodes: ['a'], mergeNodes: [] },
      { index: 1, nodes: ['b'], mergeNodes: [] },
    ];
    const { dslVars } = analyzeDSLVariables(g, levels);
    expect(dslVars.get('e1')!.referencedVars).toContain('a.v');
  });

  it('handles merge nodes in levels', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        a: node('a', [], ['v']),
        m: { ...node('m', ['v'], ['out']), type: 'merge' as const },
        c: node('c', ['out'], []),
      },
      edges: [
        { id: 'e1', from: { node: 'a', port: 'v' }, to: { node: 'm', port: 'v' } },
        {
          id: 'e2',
          from: { node: 'm', port: 'out' },
          to: { node: 'c', port: 'out' },
          condition: {
            dsl: 'jsonlogic',
            expression: { '>': [{ var: 'm.out' }, 0] },
            scope: 'full-context',
          },
        },
      ],
    };
    const levels: ExecutionLevel[] = [
      { index: 0, nodes: ['a'], mergeNodes: [] },
      { index: 1, nodes: [], mergeNodes: ['m'] },
      { index: 2, nodes: ['c'], mergeNodes: [] },
    ];
    const { dslVars } = analyzeDSLVariables(g, levels);
    expect(dslVars.get('e2')!.resolvedVars[0]!.producerNode).toBe('m');
    expect(dslVars.get('e2')!.resolvedVars[0]!.valid).toBe(true);
  });
});
