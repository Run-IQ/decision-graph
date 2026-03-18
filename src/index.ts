// Types
export type {
  DGGraph,
  DGNode,
  DGNodeType,
  DGEdge,
  EdgeEndpoint,
  EdgeCondition,
  GraphMeta,
  NodePorts,
  PortDescriptor,
  PortWiring,
  WiringMap,
  NodePolicy,
  MergeNodeConfig,
  ExecutionLimits,
  EnrichConfig,
  SubGraphConfig,
  DGEvent,
  SkipReason,
  DGStatus,
  LogLevel,
  DGResult,
  DGLevelSnapshot,
  CompiledGraph,
  ExecutionLevel,
  CompilerOptions,
  CompileWarning,
  FailurePropagationMap,
  DSLVariableMap,
  DSLVariableAnalysis,
  ResolvedVar,
} from './types/index.js';

export { IDENTIFIER_PATTERN, DEFAULT_LIMITS, ENRICH_DEFAULTS } from './types/index.js';

// Errors
export {
  DGError,
  DGCompileError,
  DGCycleError,
  DGHaltError,
  DGMergeError,
  DGLimitError,
  DGOutputSizeError,
  DGTimeoutError,
  DGMissingInputError,
  DGMissingOutputError,
} from './errors.js';

// Compiler
export { DGCompiler } from './compiler/DGCompiler.js';

// Context
export { DGContext } from './context/DGContext.js';
export type { DGContextOptions } from './context/DGContext.js';

// Executor
export type { NodeExecutor, NodeResult } from './executor/NodeExecutor.js';
export { CoreNodeExecutor } from './executor/CoreNodeExecutor.js';
export { HttpNodeExecutor } from './executor/HttpNodeExecutor.js';
export { SubGraphExecutor } from './executor/SubGraphExecutor.js';
export type { SubGraphRunner } from './executor/SubGraphExecutor.js';
export { CompositeExecutor } from './executor/CompositeExecutor.js';

// Resolver
export type { RuleResolver } from './resolver/RuleResolver.js';
export { StaticRuleResolver } from './resolver/StaticRuleResolver.js';
export { RuleStoreResolver } from './resolver/RuleStoreResolver.js';
export { CachedRuleResolver } from './resolver/CachedRuleResolver.js';
export type { CachedRuleResolverOptions } from './resolver/CachedRuleResolver.js';
export { RetryRuleResolver } from './resolver/RetryRuleResolver.js';
export type { RetryRuleResolverOptions } from './resolver/RetryRuleResolver.js';
export { TimeoutRuleResolver } from './resolver/TimeoutRuleResolver.js';
export { CompositeRuleResolver } from './resolver/CompositeRuleResolver.js';

// Orchestrator
export { DGOrchestrator } from './orchestrator/DGOrchestrator.js';
export type { DGOrchestratorOptions } from './orchestrator/DGOrchestrator.js';
export type { DGLifecycleHooks } from './orchestrator/hooks.js';

// Inspector
export { DGInspector } from './inspector/DGInspector.js';
export { explainNode } from './inspector/nodeExplainer.js';
export type { NodeExplanation } from './inspector/nodeExplainer.js';
export { traceOutput } from './inspector/outputTracer.js';
export { criticalPath } from './inspector/criticalPath.js';
export type { CriticalPathResult } from './inspector/criticalPath.js';
export { replayUntil } from './inspector/replay.js';
export type { ReplaySnapshot } from './inspector/replay.js';
export { toMermaid } from './inspector/exporters/mermaid.js';
export { toGraphviz } from './inspector/exporters/graphviz.js';
export { toVisualizationData } from './inspector/exporters/visualization.js';
export type {
  DGVisualizationData,
  DGVisualizationNode,
  DGVisualizationEdge,
} from './inspector/exporters/visualization.js';

// Pipeline
export { DGPipeline } from './pipeline/DGPipeline.js';
export type { PipelineResult, DGPipelineOptions } from './pipeline/DGPipeline.js';
export type {
  OutputLayerHandler,
  OutputLayerContext,
  OutputHandlerResult,
} from './pipeline/OutputLayer.js';

// Version
export { VERSION } from './version.js';
