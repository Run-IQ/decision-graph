import type { DGGraph } from './graph.js';
import type { PortWiring, WiringMap } from './ports.js';
import type { ExecutionLimits } from './policy.js';

export type { WiringMap, PortWiring };

export interface CompiledGraph {
  readonly source: DGGraph;
  readonly levels: readonly ExecutionLevel[];
  readonly wiring: WiringMap;
  readonly failures: FailurePropagationMap;
  readonly dslVars: DSLVariableMap;
  readonly warnings: readonly CompileWarning[];
  readonly hash: string;
  readonly compiled: {
    readonly at: string;
    readonly dgVersion: string;
    readonly contextEngineVersion: string;
    readonly coreVersion: string;
  };
}

export interface ExecutionLevel {
  readonly index: number;
  readonly nodes: readonly string[];
  readonly mergeNodes: readonly string[];
}

export interface CompilerOptions {
  readonly limits?: ExecutionLimits;
  readonly strict?: boolean;
}

export interface CompileWarning {
  readonly step: number;
  readonly message: string;
  readonly nodeId?: string;
  readonly edgeId?: string;
}

export type FailurePropagationMap = Map<
  string,
  {
    readonly policy: 'halt' | 'skip-descendants' | 'continue';
    readonly descendants: readonly string[];
  }
>;

export type DSLVariableMap = Map<string, DSLVariableAnalysis>;

export interface DSLVariableAnalysis {
  readonly edgeId: string;
  readonly referencedVars: readonly string[];
  readonly resolvedVars: readonly ResolvedVar[];
  readonly undeclaredVars: readonly string[];
}

export interface ResolvedVar {
  readonly varPath: string;
  readonly producerNode: string | 'input' | 'meta';
  readonly producerLevel: number;
  readonly destinationLevel: number;
  readonly valid: boolean;
}
