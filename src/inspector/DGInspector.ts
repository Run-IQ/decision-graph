import type { DGEvent } from '../types/events.js';
import type { DGResult } from '../types/result.js';
import type { DGGraph } from '../types/graph.js';
import { explainNode, type NodeExplanation } from './nodeExplainer.js';
import { traceOutput } from './outputTracer.js';
import { criticalPath, type CriticalPathResult } from './criticalPath.js';
import { replayUntil, type ReplaySnapshot } from './replay.js';
import { toMermaid } from './exporters/mermaid.js';
import { toGraphviz } from './exporters/graphviz.js';
import { toVisualizationData, type DGVisualizationData } from './exporters/visualization.js';

/**
 * Facade for all inspector/debugging tools.
 */
export class DGInspector {
  private readonly graph: DGGraph;
  private readonly result: DGResult;

  constructor(graph: DGGraph, result: DGResult) {
    this.graph = graph;
    this.result = result;
  }

  explainNode(nodeId: string): NodeExplanation {
    return explainNode(nodeId, this.result.events);
  }

  traceOutput(key: string): string[] {
    return traceOutput(key, this.result.events);
  }

  criticalPath(): CriticalPathResult {
    return criticalPath(this.result, this.graph);
  }

  replayUntil(until: number | ((event: DGEvent, index: number) => boolean)): ReplaySnapshot {
    return replayUntil(this.result.events, until);
  }

  toMermaid(): string {
    return toMermaid(this.graph, this.result);
  }

  toGraphviz(): string {
    return toGraphviz(this.graph, this.result);
  }

  toVisualizationData(): DGVisualizationData {
    return toVisualizationData(this.graph, this.result);
  }
}
