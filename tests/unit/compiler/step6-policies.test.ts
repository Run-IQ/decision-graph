import { describe, it, expect } from 'vitest';
import { validatePolicies } from '../../../src/compiler/steps/step6-policies.js';
import { DGCompileError } from '../../../src/errors.js';
import type { DGGraph, DGNode } from '../../../src/types/graph.js';

function node(id: string, overrides: Partial<DGNode> = {}): DGNode {
  return {
    id,
    type: 'compute',
    model: 'M',
    ports: { in: [{ name: 'v', required: false }], out: [{ name: 'v', required: false }] },
    policy: { onError: 'fail', onFailPropagation: 'halt' },
    ...overrides,
  };
}

function edge(id: string, from: string, to: string) {
  return { id, from: { node: from, port: 'v' }, to: { node: to, port: 'v' } };
}

describe('step6-policies', () => {
  it('accepts valid graph with no issues', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: node('a'), b: node('b') },
      edges: [edge('e1', 'a', 'b')],
    };
    const warnings = validatePolicies(g, false);
    expect(warnings).toEqual([]);
  });

  it('detects deadlock: merge wait-all + parent onError skip', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        a: node('a', { policy: { onError: 'skip', onFailPropagation: 'continue' } }),
        m: node('m', {
          type: 'merge',
          model: undefined,
          meta: { mergeConfig: { strategy: 'wait-all', onPartialInputs: 'fail' } },
        }),
      },
      edges: [edge('e1', 'a', 'm')],
    };
    expect(() => validatePolicies(g, false)).toThrow(DGCompileError);
  });

  it('does not flag wait-all + parent onError fallback', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        a: node('a', {
          policy: { onError: 'fallback', fallback: { v: 0 }, onFailPropagation: 'continue' },
        }),
        m: node('m', {
          type: 'merge',
          model: undefined,
          meta: { mergeConfig: { strategy: 'wait-all', onPartialInputs: 'fail' } },
        }),
      },
      edges: [edge('e1', 'a', 'm')],
    };
    expect(() => validatePolicies(g, false)).not.toThrow();
  });

  it('does not flag wait-any + parent onError skip', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        a: node('a', { policy: { onError: 'skip', onFailPropagation: 'continue' } }),
        b: node('b'),
        m: node('m', {
          type: 'merge',
          model: undefined,
          meta: { mergeConfig: { strategy: 'wait-any', onPartialInputs: 'fail' } },
        }),
      },
      edges: [edge('e1', 'a', 'm'), edge('e2', 'b', 'm')],
    };
    expect(() => validatePolicies(g, false)).not.toThrow();
  });

  it('warns when > 3 nodes have storeRaw', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        a: node('a', { policy: { onError: 'fail', onFailPropagation: 'halt', storeRaw: true } }),
        b: node('b', { policy: { onError: 'fail', onFailPropagation: 'halt', storeRaw: true } }),
        c: node('c', { policy: { onError: 'fail', onFailPropagation: 'halt', storeRaw: true } }),
        d: node('d', { policy: { onError: 'fail', onFailPropagation: 'halt', storeRaw: true } }),
      },
      edges: [],
    };
    const warnings = validatePolicies(g, false);
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    expect(warnings[0]!.message).toContain('storeRaw');
  });

  it('does not warn when exactly 3 nodes have storeRaw', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        a: node('a', { policy: { onError: 'fail', onFailPropagation: 'halt', storeRaw: true } }),
        b: node('b', { policy: { onError: 'fail', onFailPropagation: 'halt', storeRaw: true } }),
        c: node('c', { policy: { onError: 'fail', onFailPropagation: 'halt', storeRaw: true } }),
      },
      edges: [],
    };
    const warnings = validatePolicies(g, false);
    expect(warnings).toEqual([]);
  });

  it('warns on merge quorum + edge full-context', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        a: node('a'),
        m: node('m', {
          type: 'merge',
          model: undefined,
          meta: { mergeConfig: { strategy: 'wait-quorum', quorum: 1, onPartialInputs: 'fail' } },
        }),
      },
      edges: [
        {
          id: 'e1',
          from: { node: 'a', port: 'v' },
          to: { node: 'm', port: 'v' },
          condition: {
            dsl: 'jsonlogic',
            expression: { '>': [{ var: 'v' }, 0] },
            scope: 'full-context',
          },
        },
      ],
    };
    const warnings = validatePolicies(g, false);
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    expect(warnings[0]!.message).toContain('wait-quorum');
  });

  it('does not warn on merge quorum + edge source-output', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        a: node('a'),
        m: node('m', {
          type: 'merge',
          model: undefined,
          meta: { mergeConfig: { strategy: 'wait-quorum', quorum: 1, onPartialInputs: 'fail' } },
        }),
      },
      edges: [
        {
          id: 'e1',
          from: { node: 'a', port: 'v' },
          to: { node: 'm', port: 'v' },
          condition: {
            dsl: 'jsonlogic',
            expression: { '>': [{ var: 'v' }, 0] },
            scope: 'source-output',
          },
        },
      ],
    };
    const warnings = validatePolicies(g, false);
    expect(warnings).toEqual([]);
  });

  it('strict mode turns warnings into errors', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        a: node('a', { policy: { onError: 'fail', onFailPropagation: 'halt', storeRaw: true } }),
        b: node('b', { policy: { onError: 'fail', onFailPropagation: 'halt', storeRaw: true } }),
        c: node('c', { policy: { onError: 'fail', onFailPropagation: 'halt', storeRaw: true } }),
        d: node('d', { policy: { onError: 'fail', onFailPropagation: 'halt', storeRaw: true } }),
      },
      edges: [],
    };
    expect(() => validatePolicies(g, true)).toThrow(DGCompileError);
  });

  it('strict mode passes when no warnings', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: node('a'), b: node('b') },
      edges: [edge('e1', 'a', 'b')],
    };
    expect(() => validatePolicies(g, true)).not.toThrow();
  });
});
