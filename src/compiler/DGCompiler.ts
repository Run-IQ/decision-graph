import type { DGGraph } from '../types/graph.js';
import type { CompiledGraph, CompilerOptions, CompileWarning } from '../types/compiled.js';
import { DGCompileError } from '../errors.js';
import { validateIdentifiers } from './steps/step0-identifiers.js';
import { validateStructure } from './steps/step1-structure.js';
import { detectCycles } from './steps/step2-cycles.js';
import { topologicalSort } from './steps/step3-toposort.js';
import { resolveWiring } from './steps/step4-wiring.js';
import { buildFailurePropagationMap } from './steps/step5-failures.js';
import { validatePolicies } from './steps/step6-policies.js';
import { computeGraphHash } from './steps/step7-hash.js';
import { analyzeDSLVariables } from './steps/step8-dsl-vars.js';
import { VERSION } from '../version.js';
import { now } from '../utils.js';

const CONTEXT_ENGINE_VERSION = '0.2.0';
const CORE_VERSION = '0.2.6';

export class DGCompiler {
  compile(graph: DGGraph, options?: CompilerOptions): CompiledGraph {
    const strict = options?.strict ?? false;
    const allWarnings: CompileWarning[] = [];

    // Step 0 — identifier validation
    validateIdentifiers(graph);

    // Step 1 — structural validation
    validateStructure(graph);

    // Step 2 — cycle detection
    detectCycles(graph);

    // Step 3 — topological sort by levels
    const levels = topologicalSort(graph, options?.limits);

    // Step 4 — wiring resolution
    const wiring = resolveWiring(graph);

    // Step 5 — failure propagation map
    const failures = buildFailurePropagationMap(graph);

    // Step 6 — policy/deadlock validation
    const policyWarnings = validatePolicies(graph, strict);
    allWarnings.push(...policyWarnings);

    // Step 7 — SHA-256 hash
    const hash = computeGraphHash(graph);

    // Step 8 — DSL variable analysis
    const { dslVars, warnings: dslWarnings } = analyzeDSLVariables(graph, levels);
    allWarnings.push(...dslWarnings);

    if (strict && dslWarnings.length > 0) {
      throw new DGCompileError(
        `Strict mode — DSL variable warnings: ${dslWarnings.map((w) => w.message).join('; ')}`,
        8,
      );
    }

    return {
      source: graph,
      levels,
      wiring,
      failures,
      dslVars,
      warnings: allWarnings,
      hash,
      compiled: {
        at: now(),
        dgVersion: VERSION,
        contextEngineVersion: CONTEXT_ENGINE_VERSION,
        coreVersion: CORE_VERSION,
      },
    };
  }
}
