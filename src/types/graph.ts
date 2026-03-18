export const IDENTIFIER_PATTERN = /^[a-zA-Z0-9_-]+$/;

export interface DGGraph {
  readonly id: string;
  readonly version: string;
  readonly nodes: Record<string, DGNode>;
  readonly edges: readonly DGEdge[];
  readonly meta?: GraphMeta;
}

export interface DGNode {
  readonly id: string;
  readonly type: DGNodeType;
  readonly model?: string;
  readonly ports: NodePorts;
  readonly policy: NodePolicy;
  readonly meta?: Record<string, unknown>;
}

export type DGNodeType = 'compute' | 'branch' | 'guard' | 'merge';

export interface DGEdge {
  readonly id: string;
  readonly from: EdgeEndpoint;
  readonly to: EdgeEndpoint;
  readonly portAlias?: string;
  readonly condition?: EdgeCondition;
}

export interface EdgeEndpoint {
  readonly node: string;
  readonly port: string;
}

export interface EdgeCondition {
  readonly dsl: string;
  readonly expression: unknown;
  readonly scope: 'source-output' | 'full-context';
}

export interface GraphMeta {
  readonly description?: string;
  readonly domain?: string;
  readonly author?: string;
  readonly tags?: readonly string[];
  readonly executionLimits?: ExecutionLimits;
}

// Forward import — defined in policy.ts but referenced here
import type { NodePorts } from './ports.js';
import type { NodePolicy, ExecutionLimits } from './policy.js';
