# `@run-iq/dg` — Decision Graph
## Architecture Document v2.0

> **Statut** : Référence définitive pour l'implémentation  
> **Version du document** : 2.0.0  
> **Package** : `@run-iq/dg`  
> **Dépendances** : `@run-iq/core`, `@run-iq/plugin-sdk`

---

## Table des matières

1. [Pourquoi le Decision Graph existe](#1-pourquoi-le-decision-graph-existe)
2. [Ce que le DG n'est pas](#2-ce-que-le-dg-nest-pas)
3. [Paradigme fondamental : dataflow machine](#3-paradigme-fondamental--dataflow-machine)
4. [Vue d'ensemble des couches](#4-vue-densemble-des-couches)
5. [Couche 1 — Le Graphe (data pure)](#5-couche-1--le-graphe-data-pure)
6. [Couche 2 — Le Compilateur](#6-couche-2--le-compilateur)
7. [Couche 3 — Le Contexte d'exécution](#7-couche-3--le-contexte-dexécution)
8. [Couche 4 — L'Orchestrateur](#8-couche-4--lorchéstrateur)
9. [Couche 5 — NodeExecutor & RuleResolver](#9-couche-5--nodeexecutor--ruleresolver)
10. [Couche 6 — DGInspector & Replay](#10-couche-6--dginspector--replay)
11. [Matrice des effets combinés](#11-matrice-des-effets-combinés)
12. [Idempotence & déterminisme](#12-idempotence--déterminisme)
13. [Intégration avec l'écosystème Run-IQ](#13-intégration-avec-lécosystème-run-iq)
14. [Structure du package](#14-structure-du-package)
15. [Cas d'usage concrets](#15-cas-dusage-concrets)
16. [Roadmap d'implémentation](#16-roadmap-dimplémentation)
17. [Contrats de test](#17-contrats-de-test)

---

## 1. Pourquoi le Decision Graph existe

### Le problème

Le Core Run-IQ (`@run-iq/core`) est un moteur d'exécution **pur, stateless et déterministe**. Il prend un ensemble de règles et un input, retourne un résultat. C'est sa seule responsabilité — et il l'exécute parfaitement.

Mais les domaines régulés réels ne fonctionnent pas en isolation. Une déclaration fiscale d'entreprise au Togo implique simultanément :

- Le calcul de l'IRPP (plugin fiscal)
- Le calcul des obligations sociales CNSS (plugin paie)
- La vérification de conformité TVA (plugin fiscal)
- L'assemblage d'un rapport consolidé

Ces calculs ont des **dépendances entre eux** : la paie dépend du résultat fiscal, le rapport dépend des deux. Certains sont parallèles, d'autres séquentiels. Certains doivent être skippés si une condition n'est pas remplie.

Le Core ne peut pas gérer ça. Le `server` ne doit pas le gérer. Les plugins ne peuvent pas se parler. **Il manque une couche d'orchestration.**

### La solution

Le Decision Graph est cette couche. Il modélise un workflow multi-plugins comme un **graphe dirigé acyclique (DAG)** où :

- Chaque **nœud** représente une unité de calcul (appel à un plugin/modèle via le Core)
- Chaque **edge** représente une dépendance de données entre deux nœuds
- Le **contexte d'exécution** est l'unique vecteur de données circulant dans le graphe

Le DG **orchestre** sans jamais **connaître** la logique métier.

### Position dans l'architecture Run-IQ

```
┌─────────────────────────────────────────────────────────────┐
│                        Applications                          │
│              (API clients, dashboards, LLMs)                 │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│                      @run-iq/server                          │
│      (REST API — /graph/compile, /graph/execute)             │
└──────────────┬────────────────────────────┬─────────────────┘
               │                            │
┌──────────────▼──────────┐   ┌─────────────▼───────────────┐
│      @run-iq/dg          │   │      @run-iq/mcp-server      │
│  (Decision Graph)        │   │  (LLM interface — MCP)       │
└──────────────┬──────────┘   └─────────────┬───────────────┘
               │                            │
┌──────────────▼────────────────────────────▼───────────────┐
│                       @run-iq/core                         │
│         (PPEEngine — deterministic rule evaluation)         │
└────────────────────────────┬──────────────────────────────┘
                             │
┌────────────────────────────▼──────────────────────────────┐
│                      Plugins                               │
│     plugin-fiscal │ plugin-payroll │ plugin-* (custom)     │
└────────────────────────────────────────────────────────────┘
```

---

## 2. Ce que le DG n'est pas

| Ce que le DG ne fait PAS | Qui le fait |
|---|---|
| Connaître la logique fiscale, sociale, assurantielle | Les plugins |
| Exécuter les modèles de calcul | Le Core (`PPEEngine`) |
| Persister les snapshots d'exécution | Le caller |
| Interpréter les meta-rules fiscales | Le plugin fiscal via `beforeEvaluate` |
| Exposer une API HTTP | `@run-iq/server` |
| Générer des graphes depuis du texte législatif | MCP server + LLM |
| Stocker l'état entre deux exécutions | Personne — stateless pur |
| Définir les DSL évaluateurs | Le Core — le DG les consomme via injection |

**Principe cardinal** : le DG est agnostique au domaine. Les mots "taxe", "salaire", "IRPP" n'apparaissent nulle part dans son code source.

---

## 3. Paradigme fondamental : dataflow machine

Un DG fonctionne comme un **circuit électronique** : les nœuds sont des composants, les edges sont des fils, l'orchestrateur est l'horloge.

### Séparation stricte compile-time / run-time

```
COMPILE-TIME                              RUN-TIME
──────────────────────────────────────    ──────────────────────────────────────
DGGraph (JSON pur)                        CompiledGraph + ExecutionMeta
    │                                         │
    ▼                                         ▼
DGCompiler (9 étapes)                     DGOrchestrator
  ├─ Étape 0 : regex nodeId/portName        ├─ Scheduling par niveaux
  ├─ Étape 1 : validation structurelle      ├─ Promise.all limité (semaphore)
  ├─ Étape 2 : détection de cycles          ├─ Résolution edge conditions
  ├─ Étape 3 : tri topologique              ├─ runMerge avec MergePolicy
  ├─ Étape 4 : résolution wiring            ├─ Propagation des erreurs (O(1))
  ├─ Étape 5 : FailurePropagationMap        ├─ Streaming des events
  ├─ Étape 6 : validation politiques        └─ Enforcement des limites runtime
  ├─ Étape 7 : hash SHA-256
  └─ Étape 8 : analyse variables DSL
```

**Compiler une fois, exécuter N fois.** Le `CompiledGraph` est sérialisable, cacheable (LRU+TTL), identifiable par son hash SHA-256.

---

## 4. Vue d'ensemble des couches

```
@run-iq/dg
│
├── Couche 1 : DGGraph          — Le graphe comme data pure (JSON serializable)
├── Couche 2 : DGCompiler       — Validation + compilation statique (9 étapes)
├── Couche 3 : DGContext        — État append-only + event log streamable
├── Couche 4 : DGOrchestrator   — Scheduling, parallélisme limité, merges, erreurs
├── Couche 5 : NodeExecutor     — Interface vers Core (idempotente via nodeExecutionId)
│             RuleResolver      — Static / Remote / MCP / Cached / Retry / Timeout
└── Couche 6 : DGInspector      — Debug, audit, replay, visualisation (stateless)
```

---

## 5. Couche 1 — Le Graphe (data pure)

### 5.1 Contraintes de nommage (non-négociables)

```ts
const IDENTIFIER_PATTERN = /^[a-zA-Z0-9_-]+$/
```

Appliquée à **tous** les identifiants : `nodeId`, `portName`, `edgeId`, `graphId`. Aucun point, aucun espace. Un `nodeId` contenant un point (`tax.calc`) briserait le namespace `<nodeId>.<portName>`. Détecté en Étape 0 du compilateur — rejet immédiat.

### 5.2 Convention de namespace des clés de contexte

| Source | Format de clé | Exemple |
|---|---|---|
| Output d'un nœud | `<nodeId>.<portName>` | `tax_calc.taxDue` |
| Input initial | `input.<key>` | `input.income` |
| Raw du Core (si `storeRaw: true`) | `<nodeId>.__raw` | `tax_calc.__raw` |
| Sous-champ du raw | `<nodeId>.__raw.<path>` | `tax_calc.__raw.fiscalBreakdown.TVA` |

`ctx.set()` préfixe automatiquement selon la source. Collision impossible par construction.

### 5.3 DGGraph

```ts
interface DGGraph {
  id:      string          // regex ^[a-zA-Z0-9_-]+$
  version: string          // semver
  nodes:   Record<string, DGNode>
  edges:   DGEdge[]
  meta?:   GraphMeta
}

interface GraphMeta {
  description?:    string
  domain?:         string
  author?:         string
  tags?:           string[]
  executionLimits?: ExecutionLimits
}
```

### 5.4 DGNode

```ts
interface DGNode {
  id:     string          // regex ^[a-zA-Z0-9_-]+$
  type:   DGNodeType
  model?: string          // absent sur branch/guard/merge purs
  ports:  NodePorts
  policy: NodePolicy
  meta?:  Record<string, unknown>
}

type DGNodeType = 'compute' | 'branch' | 'guard' | 'merge'
```

#### Sémantique des node types

| Type | Rôle | `model` | Produit des outputs |
|---|---|---|---|
| `compute` | Exécute un modèle via le Core | Requis | Oui |
| `branch` | Route vers une seule branche selon condition | Optionnel | Non |
| `guard` | Valide les inputs, peut halter proprement | Non | Non |
| `merge` | Attend N parents, fusionne leurs outputs | Optionnel | Oui |

#### NodePorts

```ts
interface NodePorts {
  in:  PortDescriptor[]
  out: PortDescriptor[]
}

interface PortDescriptor {
  name:       string      // regex ^[a-zA-Z0-9_-]+$
  required:   boolean
  schema?:    JSONSchema
  default?:   unknown
}
```

**Principe du moindre privilège** : un nœud ne voit que ce qu'il déclare dans `ports.in`. Jamais accès au contexte global.

#### NodePolicy

```ts
interface NodePolicy {
  onError:            'fail' | 'skip' | 'fallback'
  fallback?:          Record<string, unknown>   // requis si onError = 'fallback'
  timeout?:           number                    // ms
  onFailPropagation:  'halt' | 'skip-descendants' | 'continue'
  storeRaw?:          boolean                   // défaut: false
  maxOutputSizeKb?:   number                    // défaut: 512
}
```

| `onError` | Comportement |
|---|---|
| `fail` | Lance une erreur remontée selon `onFailPropagation` |
| `skip` | Nœud marqué skipped, aucun output produit |
| `fallback` | Outputs remplacés par les valeurs `fallback` statiques |

| `onFailPropagation` | Comportement |
|---|---|
| `halt` | Toute l'exécution s'arrête immédiatement |
| `skip-descendants` | Tous les descendants transitifs sont skippés |
| `continue` | Les descendants utilisent les `default` des ports manquants |

**`storeRaw`** : défaut `false`. Mettre à `true` uniquement si un nœud downstream a besoin du `fiscalBreakdown` ou de la trace complète. Warning compilateur si > 3 nœuds ont `storeRaw: true`.

**`maxOutputSizeKb`** : protège contre les outputs volumineux légitimes (ex: `invoices: Invoice[]` avec 1000 entrées). Check effectué dans `injectOutputs()` **avant** d'écrire dans le contexte.

### 5.5 DGEdge

```ts
interface DGEdge {
  id:         string
  from:       EdgeEndpoint
  to:         EdgeEndpoint
  portAlias?: string
  condition?: EdgeCondition
}

interface EdgeEndpoint {
  node: string
  port: string
}

interface EdgeCondition {
  dsl:        string          // 'jsonlogic' | 'cel'
  expression: unknown
  scope:      'source-output' | 'full-context'
}
```

**`source-output`** : évaluée sur les outputs du nœud source uniquement.

**`full-context`** : évaluée sur l'intégralité du contexte courant — permet des conditions croisant plusieurs nœuds.

> **Contrainte compile-time** : les variables d'une expression `full-context` doivent être produites par des nœuds de niveau topologique **strictement inférieur** au nœud destination. Détectée en Étape 8 — race condition rejetée à la compilation.

### 5.6 MergeNodeConfig

Déclarée dans `node.meta.mergeConfig` pour les nœuds de type `merge`.

```ts
interface MergeNodeConfig {
  strategy:        'wait-all' | 'wait-any' | 'wait-quorum'
  quorum?:         number    // requis si wait-quorum — 1 ≤ quorum ≤ nbParents
  onPartialInputs: 'fail' | 'proceed-with-available' | 'use-defaults'
}
```

> Le quorum s'applique sur les parents dont l'edge entrante est **active au runtime** — pas sur tous les parents déclarés.

### 5.7 ExecutionLimits

```ts
interface ExecutionLimits {
  maxNodes?:         number   // défaut: 500  — compile-time
  maxDepth?:         number   // défaut: 50   — compile-time
  maxEvents?:        number   // défaut: 10_000 — runtime
  maxDurationMs?:    number   // défaut: 30_000 — runtime
  maxParallelNodes?: number   // défaut: 20   — semaphore
}
```

---

## 6. Couche 2 — Le Compilateur

### 6.1 Interface

```ts
class DGCompiler {
  compile(graph: DGGraph, options?: CompilerOptions): CompiledGraph
}

interface CompilerOptions {
  limits?: ExecutionLimits
  strict?: boolean   // warnings → erreurs
}

interface CompiledGraph {
  source:    DGGraph
  levels:    ExecutionLevel[]
  wiring:    Map<string, PortWiring[]>
  failures:  FailurePropagationMap
  dslVars:   DSLVariableMap
  warnings:  CompileWarning[]
  hash:      string
  compiled:  { at: string; dgVersion: string }
}

interface ExecutionLevel {
  index:      number
  nodes:      string[]      // parallèle (limité par semaphore)
  mergeNodes: string[]      // séquentiel après nodes
}
```

### 6.2 Les 9 étapes

#### Étape 0 — Validation des identifiants

Vérifie `graph.id`, tous les `nodeId`, tous les `portName`, tous les `edgeId` contre `IDENTIFIER_PATTERN`. Rejet immédiat si non conforme.

#### Étape 1 — Validation structurelle

- Edges : `from.node`, `to.node`, `from.port`, `to.port` existent
- Nœuds `compute` : `model` non vide
- Nœuds `merge` + `wait-quorum` : `quorum` défini et valide
- Nœuds `fallback` : `fallback` défini avec les bonnes clés

#### Étape 2 — Détection de cycles

Algorithme de Kahn (BFS). Tout cycle → `DGCycleError` avec le chemin complet.

#### Étape 3 — Tri topologique par niveaux

Les nœuds de type `merge` sont séparés dans `mergeNodes` — exécutés après tous les nœuds normaux du même niveau.

> **Note** : le DG est **level-based, not dependency-based**. Un merge attend la fin de son niveau complet, même s'il ne dépend que d'un sous-ensemble. Pour optimiser, le designer du graphe place le merge dans un niveau séparé.

Vérification des limites compile-time : `maxNodes`, `maxDepth`.

#### Étape 4 — Résolution du wiring

```ts
interface PortWiring {
  fromNode:   string
  fromPort:   string
  toNode:     string
  toPort:     string
  aliasedAs?: string
}

type WiringMap = Map<string, PortWiring[]>   // indexée par toNodeId
```

Précalculée une fois. `extractInputs()` et `injectOutputs()` font une lookup directe — pas de traversée au runtime.

#### Étape 5 — FailurePropagationMap

```ts
type FailurePropagationMap = Map<
  string,
  { policy: 'halt' | 'skip-descendants' | 'continue'; descendants: string[] }
>
```

DFS depuis chaque nœud. Lookup `O(1)` au runtime au lieu de `O(N)` par erreur.

#### Étape 6 — Validation des politiques

**Erreur bloquante** (deadlock garanti) :

```
DGCompileError: Deadlock détecté.
  Node "summary" (merge, wait-all) a pour parent "insurance_calc"
  avec policy { onError: 'skip', onFailPropagation: 'continue' }.
  Un parent skippé ne produira jamais d'output → deadlock garanti.
  Fix: utiliser merge.strategy 'wait-any', ou changer onError en 'fallback'.
```

Règle : `merge.strategy === 'wait-all'` + parent avec `onError: 'skip'` = rejeté systématiquement.

**Warnings** :
- Merge quorum + edge full-context (quorum effectif imprévisible statiquement)
- Plus de 3 nœuds avec `storeRaw: true`

#### Étape 7 — Hash SHA-256

```ts
const hash = sha256(JSON.stringify({ id: graph.id, version: graph.version, nodes: graph.nodes, edges: graph.edges }))
```

Identifie univoquement la version du graphe. Utilisé pour le cache, l'audit, et la détection de modification silencieuse.

#### Étape 8 — Analyse statique des variables DSL

```ts
interface DSLVariableAnalysis {
  edgeId:         string
  referencedVars: string[]
  resolvedVars:   ResolvedVar[]
  undeclaredVars: string[]    // warning — peut venir de meta.context
}

interface ResolvedVar {
  varPath:          string
  producerNode:     string | 'input' | 'meta'
  producerLevel:    number
  destinationLevel: number
  valid:            boolean   // producerLevel < destinationLevel
}
```

Pour chaque edge avec condition : extraire les variables (walk JSONLogic `{ "var": "..." }`, parser léger CEL), vérifier que chaque producteur est à un niveau strictement inférieur.

**Erreur** : variable produite par un nœud de même niveau ou supérieur.
**Warning** : variable non trouvée dans aucun nœud.

---

## 7. Couche 3 — Le Contexte d'exécution

### 7.1 DGEvent

```ts
type DGEvent =
  | { type: 'graph.started';    graphId: string; hash: string; requestId: string; ts: string }
  | { type: 'level.started';    level: number; nodes: string[]; mergeNodes: string[]; ts: string }
  | { type: 'node.started';     nodeId: string; nodeExecutionId: string; inputs: Record<string, unknown>; ts: string }
  | { type: 'node.completed';   nodeId: string; nodeExecutionId: string; outputs: Record<string, unknown>; durationMs: number; ts: string }
  | { type: 'node.raw_stored';  nodeId: string; sizeKb: number; ts: string }
  | { type: 'node.skipped';     nodeId: string; reason: SkipReason; ts: string }
  | { type: 'node.failed';      nodeId: string; nodeExecutionId: string; error: string; propagation: string; ts: string }
  | { type: 'node.fallback';    nodeId: string; fallback: Record<string, unknown>; ts: string }
  | { type: 'edge.inactive';    edgeId: string; scope: string; evaluated: unknown; ts: string }
  | { type: 'merge.waiting';    nodeId: string; strategy: string; waiting: string[]; received: string[]; ts: string }
  | { type: 'output.size_warn'; nodeId: string; sizeKb: number; limitKb: number; ts: string }
  | { type: 'level.completed';  level: number; durationMs: number; ts: string }
  | { type: 'graph.completed';  status: DGStatus; durationMs: number; ts: string }

type SkipReason =
  | 'edge-condition-false'
  | 'parent-failed-propagation'
  | 'guard-rejected'
  | 'merge-partial-inputs-failed'
  | 'timeout'

type DGStatus = 'completed' | 'failed' | 'partial'
```

### 7.2 DGContext

```ts
class DGContext {
  private state:     Map<string, unknown> = new Map()
  private eventLog:  DGEvent[]            = []
  private eventCount: number = 0

  // ─── State — append-only strict ───────────────────────────────────────────

  set(nodeId: string, portName: string, value: unknown): void {
    const key = `${nodeId}.${portName}`
    if (this.state.has(key)) {
      throw new DGConflictError(`Key "${key}" already produced. Graph design error.`)
    }
    this.state.set(key, Object.freeze(value))
  }

  setRaw(nodeId: string, raw: unknown): void {
    this.state.set(`${nodeId}.__raw`, Object.freeze(raw))
  }

  get(key: string): unknown {
    return this.state.get(key) ?? this.state.get(`input.${key}`) ?? undefined
  }

  getFullState(): Record<string, unknown> {
    return Object.fromEntries(this.state)
  }

  // ─── Events ───────────────────────────────────────────────────────────────

  emit(event: DGEvent): void {
    if (!this.shouldLog(event.type)) return
    this.eventCount++
    if (this.eventCount > (this.options.limits?.maxEvents ?? 10_000)) {
      throw new DGLimitError(`maxEvents exceeded`)
    }
    this.eventLog.push(Object.freeze(event))
    this.options.streaming?.emit('dg:event', event)
  }

  // ─── Snapshot partiel par niveau ──────────────────────────────────────────

  levelSnapshot(level: number): DGLevelSnapshot {
    return {
      level,
      stateAtLevel: Object.fromEntries(this.state),
      events: this.eventLog.filter(e => this.isLevelEvent(e, level))
    }
  }
}
```

#### logLevel

| Level | Events enregistrés | Usage |
|---|---|---|
| `minimal` | `graph.started`, `node.failed`, `graph.completed` | Production haute charge |
| `standard` | + `node.started/completed/skipped`, `level.*`, `node.fallback` | Production normale |
| `verbose` | Tout | Debug, audit légal |

#### Append-only strict

Un nœud ne peut jamais écraser une clé déjà produite. Si deux nœuds tentent d'écrire la même clé → `DGConflictError` — bug de design du graphe, pas une erreur runtime récupérable.

### 7.3 ExecutionMeta

```ts
interface ExecutionMeta {
  requestId:      string    // UUID unique par exécution — idempotence
  tenantId:       string
  userId?:        string
  timestamp:      string    // ISO 8601 — fixé au démarrage, jamais muté
  effectiveDate?: string
  context?:       Record<string, unknown>
}
```

`timestamp` est fixé une seule fois à la création du contexte. Toutes les résolutions de règles l'utilisent — garantie de déterminisme.

---

## 8. Couche 4 — L'Orchestrateur

### 8.1 Interface publique

```ts
class DGOrchestrator {
  constructor(
    private executor: NodeExecutor,
    private dsls:     Map<string, DSLEvaluator>,   // injecté depuis PPEEngine
    private options?: DGOrchestratorOptions
  ) {}

  async execute(
    compiled: CompiledGraph,
    input:    Record<string, unknown>,
    meta:     ExecutionMeta
  ): Promise<DGResult>
}

interface DGOrchestratorOptions {
  logLevel?:  LogLevel
  streaming?: EventEmitter
  limits?:    ExecutionLimits
  hooks?:     DGLifecycleHooks
}
```

**Injection des DSLEvaluators** : le DG consomme la `Map<string, DSLEvaluator>` du Core — jamais redéfinie. Le `DSLEvaluator` est l'interface définie dans `@run-iq/core` :

```ts
// Défini dans @run-iq/core — consommé tel quel
interface DSLEvaluator {
  readonly dsl:     string
  readonly version: string
  evaluate(expression: unknown, context: Record<string, unknown>): boolean
  describeSyntax?(): DSLSyntaxDoc
}
```

### 8.2 Algorithme d'exécution

```
execute(compiled, input, meta):
  ctx = new DGContext(input, meta, options)
  startTime = Date.now()
  emit graph.started

  await hooks?.beforeGraph?.(compiled, meta)

  pour chaque level dans compiled.levels:
    emit level.started

    activeNodes = await resolveActiveNodes(level.nodes, compiled, ctx)
    await parallelWithLimit(
      activeNodes.map(id => () => runNode(nodes[id], compiled, ctx)),
      options.limits?.maxParallelNodes ?? 20
    )

    pour chaque mergeId dans level.mergeNodes:
      if nodeIsActive(mergeId, compiled, ctx):
        await runMerge(nodes[mergeId], compiled, ctx)
      else:
        ctx.emit node.skipped (reason: edge-condition-false)

    if (Date.now() - startTime > limits.maxDurationMs):
      throw new DGLimitError('maxDurationMs exceeded')

    emit level.completed

  emit graph.completed
  await hooks?.afterGraph?.(result)
  return ctx.buildResult(compiled)
```

### 8.3 Parallélisme limité (semaphore)

```ts
async function parallelWithLimit<T>(
  tasks: Array<() => Promise<T>>,
  limit: number
): Promise<T[]> {
  const results: T[] = []
  let index = 0, active = 0

  return new Promise((resolve, reject) => {
    function runNext() {
      if (index === tasks.length && active === 0) { resolve(results); return }
      while (active < limit && index < tasks.length) {
        const i = index++
        active++
        tasks[i]()
          .then(r => { results[i] = r; active--; runNext() })
          .catch(err => { active--; reject(err) })
      }
    }
    runNext()
  })
}
```

Protège contre les niveaux avec N nœuds indépendants qui satureraient le CPU en `Promise.all` non contrôlé.

### 8.4 Résolution des nœuds actifs

Un nœud est actif si toutes ses edges entrantes sont actives (ou s'il est racine). Une edge est active si elle n'a pas de condition, ou si sa condition évalue à `true`.

```ts
private async resolveActiveNodes(nodeIds, compiled, ctx): Promise<string[]> {
  const results = await Promise.all(
    nodeIds.map(async nodeId => {
      const incomingEdges = compiled.source.edges.filter(e => e.to.node === nodeId)
      if (incomingEdges.length === 0) return nodeId

      for (const edge of incomingEdges) {
        if (!edge.condition) continue

        const evalCtx = edge.condition.scope === 'full-context'
          ? ctx.getFullState()
          : ctx.getNodeOutputs(edge.from.node)

        const dsl = this.dsls.get(edge.condition.dsl)
        if (!dsl) throw new DGError(`DSL '${edge.condition.dsl}' not in registry`)

        const active = dsl.evaluate(edge.condition.expression, evalCtx)
        if (!active) {
          ctx.emit({ type: 'edge.inactive', edgeId: edge.id, scope: edge.condition.scope, evaluated: evalCtx, ts: now() })
          return null
        }
      }
      return nodeId
    })
  )
  return results.filter(Boolean) as string[]
}
```

### 8.5 Exécution d'un nœud compute

```ts
private async runNode(node, compiled, ctx): Promise<void> {
  const inputs = this.extractInputs(node, compiled.wiring, ctx)
  const nodeExecutionId = `${ctx.meta.requestId}:${node.id}`
  ctx.emit({ type: 'node.started', nodeId: node.id, nodeExecutionId, inputs, ts: now() })
  const start = Date.now()

  await this.options?.hooks?.beforeNode?.(node, inputs)

  try {
    const resultPromise = this.executor.execute(node, inputs, ctx.meta)
    const result = node.policy.timeout
      ? await withTimeout(resultPromise, node.policy.timeout, `Node "${node.id}" timed out`)
      : await resultPromise

    // Check taille avant injection
    const sizeKb = roughSizeKb(result.outputs)
    if (sizeKb > (node.policy.maxOutputSizeKb ?? 512)) {
      throw new DGOutputSizeError(`Node "${node.id}" output ${sizeKb}kb > limit`)
    }

    this.injectOutputs(node, result, compiled.wiring, ctx)
    if (node.policy.storeRaw && result.raw !== undefined) ctx.setRaw(node.id, result.raw)

    ctx.emit({ type: 'node.completed', nodeId: node.id, nodeExecutionId, outputs: result.outputs, durationMs: Date.now() - start, ts: now() })
    await this.options?.hooks?.afterNode?.(node, result)

  } catch (err) {
    await this.handleNodeError(node, err as Error, compiled, ctx)
  }
}
```

### 8.6 Gestion des erreurs et propagation

```ts
private async handleNodeError(node, err, compiled, ctx): Promise<void> {
  // Fallback
  if (node.policy.onError === 'fallback' && node.policy.fallback) {
    for (const [port, value] of Object.entries(node.policy.fallback)) {
      ctx.set(node.id, port, value)
    }
    ctx.emit({ type: 'node.fallback', nodeId: node.id, fallback: node.policy.fallback, ts: now() })
    return
  }

  // Skip
  if (node.policy.onError === 'skip') {
    ctx.emit({ type: 'node.skipped', nodeId: node.id, reason: 'edge-condition-false', ts: now() })
    return
  }

  // Fail + propagation
  ctx.emit({ type: 'node.failed', nodeId: node.id, nodeExecutionId: `${ctx.meta.requestId}:${node.id}`, error: err.message, propagation: node.policy.onFailPropagation, ts: now() })

  const propagation = compiled.failures.get(node.id)!

  switch (node.policy.onFailPropagation) {
    case 'halt':
      throw new DGHaltError(`Node "${node.id}" failed with halt policy`, err)
    case 'skip-descendants':
      for (const id of propagation.descendants) {
        ctx.emit({ type: 'node.skipped', nodeId: id, reason: 'parent-failed-propagation', ts: now() })
      }
      break
    case 'continue':
      break   // descendants utilisent les defaults des ports manquants
  }
}
```

### 8.7 Exécution d'un merge node

```ts
private async runMerge(node, compiled, ctx): Promise<void> {
  const config: MergeNodeConfig = node.meta?.mergeConfig ?? { strategy: 'wait-all', onPartialInputs: 'fail' }

  const parentEdges      = compiled.source.edges.filter(e => e.to.node === node.id)
  const activeParents    = parentEdges.filter(e => !ctx.isEdgeInactive(e.id))
  const completedParents = activeParents.filter(e => ctx.isCompleted(e.from.node))

  const quorumMet =
    config.strategy === 'wait-all'  ? completedParents.length === activeParents.length :
    config.strategy === 'wait-any'  ? completedParents.length >= 1 :
    /* wait-quorum */                 completedParents.length >= (config.quorum ?? activeParents.length)

  if (!quorumMet) {
    ctx.emit({ type: 'merge.waiting', nodeId: node.id, strategy: config.strategy,
      waiting: activeParents.filter(e => !ctx.isCompleted(e.from.node)).map(e => e.from.node),
      received: completedParents.map(e => e.from.node), ts: now() })

    switch (config.onPartialInputs) {
      case 'fail':
        return this.handleNodeError(node, new DGMergeError(`Quorum not met for "${node.id}"`), compiled, ctx)
      case 'proceed-with-available':
      case 'use-defaults':
        break
    }
  }

  const mergedInputs = this.mergeInputs(completedParents, node, config)
  const result = await this.executor.execute(node, mergedInputs, ctx.meta)
  this.injectOutputs(node, result, compiled.wiring, ctx)
}
```

### 8.8 DGLifecycleHooks

```ts
interface DGLifecycleHooks {
  // Observation uniquement — ne peuvent pas modifier le contexte
  beforeGraph?(compiled: CompiledGraph, meta: ExecutionMeta): Promise<void>
  beforeNode?(node: DGNode, inputs: Record<string, unknown>): Promise<void>
  afterNode?(node: DGNode, result: NodeResult): Promise<void>
  afterGraph?(result: DGResult): Promise<void>
  onError?(node: DGNode, error: Error): Promise<void>
}
```

---

## 9. Couche 5 — NodeExecutor & RuleResolver

### 9.1 NodeExecutor

```ts
interface NodeExecutor {
  execute(
    node:   DGNode,
    inputs: Record<string, unknown>,
    meta:   ExecutionMeta
  ): Promise<NodeResult>
}

interface NodeResult {
  outputs:    Record<string, unknown>
  raw?:       unknown     // résultat complet du Core (conservé si storeRaw: true)
  durationMs: number
}
```

### 9.2 CoreNodeExecutor — idempotence garantie

```ts
class CoreNodeExecutor implements NodeExecutor {
  constructor(private engine: PPEEngine, private resolver: RuleResolver) {}

  async execute(node, inputs, meta): Promise<NodeResult> {
    const start = Date.now()
    const rules = await this.resolver.resolve(node, meta)

    // nodeExecutionId garantit l'idempotence par composition avec le Core
    const nodeExecutionId = `${meta.requestId}:${node.id}`

    const result = await this.engine.evaluate({
      rules,
      input: {
        data:      inputs,
        requestId: nodeExecutionId,   // Core est idempotent sur requestId
        meta: { tenantId: meta.tenantId, effectiveDate: meta.effectiveDate, context: meta.context }
      }
    })

    return {
      outputs:    this.mapOutputPorts(node.ports.out, result),
      raw:        result,
      durationMs: Date.now() - start
    }
  }
}
```

**Idempotence** : `nodeExecutionId = ${graphRequestId}:${nodeId}` est unique, déterministe. Un retry avec le même `requestId` retourne le snapshot existant sans ré-exécution côté Core.

### 9.3 RuleResolver

```ts
interface RuleResolver {
  resolve(node: DGNode, meta: ExecutionMeta): Promise<Rule[]>
  fingerprint(node: DGNode, meta: ExecutionMeta): string
}
```

Le fingerprint encode tout ce qui peut faire varier la résolution :

```ts
fingerprint(node, meta): string {
  return sha256(JSON.stringify({
    nodeId:        node.id,
    model:         node.model ?? null,
    tenantId:      meta.tenantId,
    effectiveDate: meta.effectiveDate ?? meta.timestamp.split('T')[0],
    country:       meta.context?.country ?? null
  }))
}
```

### 9.4 Implémentations disponibles

#### StaticRuleResolver

Règles inline. Usage : dev, tests, démos.

#### RemoteRuleResolver

```ts
class RemoteRuleResolver implements RuleResolver {
  constructor(private client: RuleStoreClient) {}

  async resolve(node, meta): Promise<Rule[]> {
    return this.client.fetchRules({ model: node.model, tenantId: meta.tenantId, effectiveDate: meta.effectiveDate, country: meta.context?.country })
  }
}
```

#### MCPRuleResolver

Génération à la volée via LLM. TTL par session uniquement — jamais cross-session.

#### CachedRuleResolver — LRU + TTL

```ts
class CachedRuleResolver implements RuleResolver {
  private cache: LRUCache<string, { rules: Rule[]; expiresAt: number }>

  constructor(private inner: RuleResolver, private options: { maxEntries: number; ttlMs: number }) {
    this.cache = new LRUCache({ max: options.maxEntries })
  }

  async resolve(node, meta): Promise<Rule[]> {
    const key = this.inner.fingerprint(node, meta)
    const hit = this.cache.get(key)
    if (hit && Date.now() < hit.expiresAt) return hit.rules
    const rules = await this.inner.resolve(node, meta)
    this.cache.set(key, { rules, expiresAt: Date.now() + this.options.ttlMs })
    return rules
  }
}
```

TTL recommandés :

| Resolver | TTL |
|---|---|
| `StaticRuleResolver` | Infini |
| `RemoteRuleResolver` | 5 minutes |
| `MCPRuleResolver` | Session uniquement |

#### RetryRuleResolver

```ts
class RetryRuleResolver implements RuleResolver {
  constructor(private inner: RuleResolver, private options: { attempts: number; backoffMs: number }) {}

  async resolve(node, meta): Promise<Rule[]> {
    for (let attempt = 1; attempt <= this.options.attempts; attempt++) {
      try { return await this.inner.resolve(node, meta) }
      catch (err) {
        if (attempt === this.options.attempts) throw err
        await sleep(this.options.backoffMs * attempt)
      }
    }
    throw new Error('unreachable')
  }
}
```

#### TimeoutRuleResolver

```ts
class TimeoutRuleResolver implements RuleResolver {
  constructor(private inner: RuleResolver, private timeoutMs: number) {}

  async resolve(node, meta): Promise<Rule[]> {
    return withTimeout(this.inner.resolve(node, meta), this.timeoutMs, `RuleResolver timeout for "${node.id}"`)
  }
}
```

#### CompositeRuleResolver

```ts
class CompositeRuleResolver implements RuleResolver {
  constructor(private resolvers: RuleResolver[]) {}

  async resolve(node, meta): Promise<Rule[]> {
    return (await Promise.all(this.resolvers.map(r => r.resolve(node, meta)))).flat()
  }
}
```

#### Composition recommandée pour la production

```ts
const resolver = new CachedRuleResolver(
  new TimeoutRuleResolver(
    new RetryRuleResolver(
      new CompositeRuleResolver([
        new RemoteRuleResolver(fiscalDbClient),
        new RemoteRuleResolver(payrollDbClient),
      ]),
      { attempts: 3, backoffMs: 100 }
    ),
    5_000
  ),
  { maxEntries: 1000, ttlMs: 300_000 }
)
```

---

## 10. Couche 6 — DGInspector & Replay

Stateless et pur — prend des données, retourne une analyse. Aucun couplage avec l'orchestrateur.

### 10.1 Interface

```ts
interface DGInspector {
  explainNode(nodeId: string, events: readonly DGEvent[]): NodeExplanation
  traceOutput(key: string, events: readonly DGEvent[]): string[]
  criticalPath(result: DGResult, graph: DGGraph): CriticalPathResult
  replayUntil(events: readonly DGEvent[], until: ReplayUntil): ReplaySnapshot
  verify(result: DGResult): VerificationResult
  toMermaid(graph: DGGraph, result?: DGResult): string
  toGraphviz(graph: DGGraph, result?: DGResult): string
  toVisualizationData(graph: DGGraph, result?: DGResult): DGVisualizationData
}

type ReplayUntil =
  | { type: 'node';  nodeId: string }
  | { type: 'level'; level: number }
  | { type: 'ts';    ts: string }

interface NodeExplanation {
  nodeId:         string
  status:         'completed' | 'skipped' | 'failed' | 'fallback'
  reason?:        SkipReason | string
  inactiveEdges?: { edgeId: string; condition: EdgeCondition; evaluated: unknown }[]
  failedParent?:  string
  fallbackUsed?:  Record<string, unknown>
  durationMs?:    number
}

interface CriticalPathResult {
  path:       string[]
  totalMs:    number
  bottleneck: string
  perNode:    Record<string, number>
}

interface ReplaySnapshot {
  replayedUntil:  ReplayUntil
  stateAtPoint:   Record<string, unknown>
  executed:       string[]
  skipped:        string[]
  eventsReplayed: number
}

interface VerificationResult {
  reproducible: boolean
  divergences:  Array<{ nodeId: string; expected: unknown; actual: unknown }>
}
```

### 10.2 Replay

Le replay **ne ré-exécute pas le Core**. Il rejoue les events pour reconstruire l'état — lecture pure du log immuable. Essentiel pour l'audit légal.

```ts
replayUntil(events, until): ReplaySnapshot {
  const state = new Map<string, unknown>()
  const executed: string[] = [], skipped: string[] = []
  let count = 0

  for (const event of events) {
    if (this.reachedUntil(event, until)) break
    count++
    if (event.type === 'node.completed') {
      for (const [k, v] of Object.entries(event.outputs)) state.set(`${event.nodeId}.${k}`, v)
      executed.push(event.nodeId)
    }
    if (event.type === 'node.skipped') skipped.push(event.nodeId)
  }

  return { replayedUntil: until, stateAtPoint: Object.fromEntries(state), executed, skipped, eventsReplayed: count }
}
```

### 10.3 Export Mermaid

```ts
toMermaid(graph, result?): string {
  const lines = ['flowchart LR']
  for (const [id, node] of Object.entries(graph.nodes)) {
    const icon = result
      ? result.executed.includes(id) ? '✅' : result.skipped.includes(id) ? '⏭️' : result.failed.includes(id) ? '❌' : '⬜'
      : ''
    lines.push(`  ${id}["${icon} ${id}\\n(${node.type})"]`)
  }
  for (const edge of graph.edges) {
    const label = edge.condition ? `|${edge.condition.scope}|` : ''
    lines.push(`  ${edge.from.node} -->${label} ${edge.to.node}`)
  }
  return lines.join('\n')
}
```

### 10.4 Accès CLI

```bash
run-iq dg compile   graph.json
run-iq dg run       graph.json --input data.json
run-iq dg inspect   result.json --node summary_report
run-iq dg trace     result.json --key tax_calc.taxDue
run-iq dg critical  result.json graph.json
run-iq dg replay    result.json --until node:payroll
run-iq dg verify    result.json
run-iq dg viz       graph.json --format mermaid
```

---

## 11. Matrice des effets combinés

| `onError` parent | `onFailProp.` | `merge.strategy` | `merge.onPartialInputs` | Résultat | Détection |
|---|---|---|---|---|---|
| `fail` | `halt` | — | — | ⛔ Graphe stoppé | runtime |
| `fail` | `skip-descendants` | `wait-all` | `fail` | ⚠️ Merge échoue | runtime |
| `fail` | `skip-descendants` | `wait-all` | `proceed-with-available` | ⚠️ Merge tente sans ce parent | runtime |
| `fail` | `skip-descendants` | `wait-all` | `use-defaults` | ⚠️ Merge utilise defaults | runtime |
| `fail` | `continue` | `wait-all` | `proceed-with-available` | ✅ Merge continue | runtime |
| `fail` | `continue` | `wait-all` | `use-defaults` | ✅ Merge utilise defaults | runtime |
| `fail` | `continue` | `wait-any` | any | ✅ Merge si autre parent complète | runtime |
| `skip` | `continue` | `wait-all` | any | 🚫 **DEADLOCK** | **compile** |
| `skip` | `skip-descendants` | `wait-all` | any | 🚫 **DEADLOCK** | **compile** |
| `skip` | `continue` | `wait-any` | any | ✅ Merge si autre parent complète | runtime |
| `skip` | `continue` | `wait-quorum` | any | ✅ si quorum sans ce parent | runtime |
| `skip` | `continue` | `wait-quorum` | `fail` | ⚠️ Merge échoue si quorum non atteint | runtime |
| `fallback` | `continue` | `wait-all` | any | ✅ Fallback injecté, merge attend | runtime |
| `fallback` | `continue` | `wait-any` | any | ✅ Fallback injecté, merge immédiat | runtime |

---

## 12. Idempotence & déterminisme

### Idempotence des nœuds

Le DG peut être relancé (timeout, crash, retry). Sans idempotence, un nœud peut s'exécuter deux fois côté Core.

**Solution** : `nodeExecutionId = ${meta.requestId}:${node.id}`

Le Core PPE est **architecturalement idempotent** sur `requestId` : un `requestId` déjà traité retourne le snapshot existant. Le DG hérite de cette garantie par composition.

Deux appels avec le même `meta.requestId` et le même `node.id` → même `nodeExecutionId` → même résultat, zéro double exécution.

### Déterminisme de l'exécution

| Composant | Garantie |
|---|---|
| `meta.timestamp` | Fixé au démarrage, jamais muté |
| `RuleResolver.fingerprint` | Même inputs → même fingerprint → même règles |
| `CompiledGraph.hash` | Identifie exactement la version du graphe exécuté |
| `DGContext` append-only | Aucun écrasement possible |
| `parallelWithLimit` | Ordre déterministe dans les limites du semaphore |

---

## 13. Intégration avec l'écosystème Run-IQ

### 13.1 @run-iq/server

```
POST /graph/compile          → DGCompiler.compile(graph) → CompiledGraph
POST /graph/execute          → DGOrchestrator.execute(compiled, input, meta)
POST /graph/run              → compile + execute (one-shot)
GET  /graph/:hash            → CompiledGraph depuis cache Redis
POST /graph/:hash/execute    → exécution pré-compilée (le plus rapide)
```

Cache Redis recommandé : `CompiledGraph` par `hash`. Les graphes récurrents ne sont compilés qu'une seule fois.

### 13.2 @run-iq/mcp-server

| Outil MCP | Description |
|---|---|
| `compile_graph` | Compile un DGGraph JSON — retourne warnings/erreurs |
| `execute_graph` | Exécute avec un input — retourne DGResult |
| `inspect_graph_result` | Analyse (critical path, skip explanations) |
| `visualize_graph` | Diagramme Mermaid avec état si result fourni |
| `replay_execution` | Rejoue jusqu'à un point donné |

### 13.3 Initialisation

```ts
const engine      = new PPEEngine({ plugins: [fiscalPlugin], dsls: [jsonlogicDSL] })
const dslRegistry = engine.getDSLRegistry()   // Map<string, DSLEvaluator>

const orchestrator = new DGOrchestrator(
  new CoreNodeExecutor(engine, resolver),
  dslRegistry,   // ← injecté, jamais redéfini dans le DG
  options
)
```

### 13.4 Plugin fiscal — interaction transparente

Le DG appelle `engine.evaluate()`. Le plugin fiscal exécute son `beforeEvaluate` hook en interne. Le DG ne voit jamais META_INHIBITION, META_SUBSTITUTION, jurisdiction resolution — il reçoit juste un `EvaluationResult`.

Avec `storeRaw: true`, les nœuds downstream peuvent accéder au breakdown :

```json
{ "name": "tax_calc.__raw.fiscalBreakdown.TVA", "required": false, "default": 0 }
```

---

## 14. Structure du package

```
packages/dg/
├── src/
│   ├── types/
│   │   ├── graph.ts            → DGGraph, DGNode, DGEdge, DGNodeType, GraphMeta
│   │   ├── ports.ts            → PortDescriptor, PortWiring, EdgeEndpoint
│   │   ├── policy.ts           → NodePolicy, MergeNodeConfig, ExecutionLimits
│   │   ├── events.ts           → DGEvent, SkipReason, DGStatus, LogLevel
│   │   ├── result.ts           → DGResult, DGLevelSnapshot, ExecutionMeta
│   │   ├── compiled.ts         → CompiledGraph, ExecutionLevel, FailurePropagationMap, DSLVariableMap
│   │   └── index.ts
│   │
│   ├── compiler/
│   │   ├── DGCompiler.ts
│   │   ├── steps/
│   │   │   ├── step0-identifiers.ts
│   │   │   ├── step1-structure.ts
│   │   │   ├── step2-cycles.ts
│   │   │   ├── step3-toposort.ts
│   │   │   ├── step4-wiring.ts
│   │   │   ├── step5-failures.ts
│   │   │   ├── step6-policies.ts
│   │   │   ├── step7-hash.ts
│   │   │   └── step8-dsl-vars.ts
│   │   └── errors.ts
│   │
│   ├── context/
│   │   ├── DGContext.ts
│   │   └── logLevels.ts
│   │
│   ├── orchestrator/
│   │   ├── DGOrchestrator.ts
│   │   ├── nodeRunner.ts
│   │   ├── mergeRunner.ts
│   │   ├── edgeResolver.ts
│   │   ├── parallelWithLimit.ts
│   │   └── hooks.ts
│   │
│   ├── executor/
│   │   ├── NodeExecutor.ts
│   │   └── CoreNodeExecutor.ts
│   │
│   ├── resolver/
│   │   ├── RuleResolver.ts
│   │   ├── StaticRuleResolver.ts
│   │   ├── RemoteRuleResolver.ts
│   │   ├── MCPRuleResolver.ts
│   │   ├── CachedRuleResolver.ts
│   │   ├── RetryRuleResolver.ts
│   │   ├── TimeoutRuleResolver.ts
│   │   └── CompositeRuleResolver.ts
│   │
│   ├── inspector/
│   │   ├── DGInspector.ts
│   │   ├── nodeExplainer.ts
│   │   ├── outputTracer.ts
│   │   ├── criticalPath.ts
│   │   ├── replay.ts
│   │   └── exporters/
│   │       ├── mermaid.ts
│   │       ├── graphviz.ts
│   │       └── visualization.ts
│   │
│   ├── errors.ts     → DGError, DGCycleError, DGConflictError, DGHaltError,
│   │                    DGMergeError, DGLimitError, DGOutputSizeError, DGTimeoutError
│   ├── utils.ts      → now(), sleep(), roughSizeKb(), withTimeout(), sha256()
│   └── index.ts
│
├── tests/
│   ├── unit/
│   │   ├── compiler/
│   │   │   ├── step0-identifiers.test.ts
│   │   │   ├── step1-structure.test.ts
│   │   │   ├── step2-cycles.test.ts
│   │   │   ├── step3-toposort.test.ts
│   │   │   ├── step4-wiring.test.ts
│   │   │   ├── step5-failures.test.ts
│   │   │   ├── step6-policies.test.ts
│   │   │   ├── step7-hash.test.ts
│   │   │   └── step8-dsl-vars.test.ts
│   │   ├── context/
│   │   │   ├── append-only.test.ts
│   │   │   └── log-levels.test.ts
│   │   ├── orchestrator/
│   │   │   ├── parallel-limit.test.ts
│   │   │   ├── edge-conditions.test.ts
│   │   │   └── failure-propagation.test.ts
│   │   ├── resolver/
│   │   │   ├── cached-resolver.test.ts
│   │   │   ├── retry-resolver.test.ts
│   │   │   └── timeout-resolver.test.ts
│   │   └── inspector/
│   │       ├── replay.test.ts
│   │       └── critical-path.test.ts
│   │
│   └── integration/
│       ├── single-domain.test.ts
│       ├── multi-domain.test.ts
│       ├── conditional-routing.test.ts
│       ├── failure-propagation.test.ts
│       ├── merge-strategies.test.ts
│       ├── policy-matrix.test.ts       ← toutes les combinaisons §11
│       ├── idempotence.test.ts
│       ├── limits.test.ts
│       └── replay.test.ts
│
├── package.json
├── tsconfig.json
└── ARCHITECTURE.md
```

---

## 15. Cas d'usage concrets

### 15.1 Calcul fiscal multi-modèles (Togo, régime réel)

```json
{
  "id": "tg-fiscal-reel",
  "version": "1-0-0",
  "nodes": {
    "irpp": {
      "id": "irpp", "type": "compute", "model": "PROGRESSIVE_BRACKET",
      "ports": { "in": [{ "name": "income", "required": true }], "out": [{ "name": "irppDue", "required": true }] },
      "policy": { "onError": "fail", "onFailPropagation": "halt" }
    },
    "tva": {
      "id": "tva", "type": "compute", "model": "FLAT_RATE",
      "ports": { "in": [{ "name": "revenue", "required": true }], "out": [{ "name": "tvaDue", "required": true }] },
      "policy": { "onError": "fail", "onFailPropagation": "halt" }
    },
    "imf": {
      "id": "imf", "type": "compute", "model": "MINIMUM_TAX",
      "ports": { "in": [{ "name": "revenue", "required": true }], "out": [{ "name": "imfDue", "required": true }] },
      "policy": { "onError": "fallback", "fallback": { "imfDue": 500000 }, "onFailPropagation": "continue" }
    },
    "report": {
      "id": "report", "type": "merge",
      "ports": {
        "in": [
          { "name": "irpp.irppDue", "required": true },
          { "name": "tva.tvaDue",   "required": true },
          { "name": "imf.imfDue",   "required": true }
        ],
        "out": [{ "name": "totalTax", "required": true }]
      },
      "policy": { "onError": "fail", "onFailPropagation": "halt" },
      "meta": { "mergeConfig": { "strategy": "wait-all", "onPartialInputs": "use-defaults" } }
    }
  },
  "edges": [
    { "id": "e1", "from": { "node": "irpp", "port": "irppDue" }, "to": { "node": "report", "port": "irpp.irppDue" } },
    { "id": "e2", "from": { "node": "tva",  "port": "tvaDue"  }, "to": { "node": "report", "port": "tva.tvaDue"  } },
    { "id": "e3", "from": { "node": "imf",  "port": "imfDue"  }, "to": { "node": "report", "port": "imf.imfDue"  } }
  ]
}
```

Niveaux compilés :
- Niveau 0 — `nodes: [irpp, tva, imf]` → `Promise.all` (limité par `maxParallelNodes`)
- Niveau 1 — `mergeNodes: [report]` → séquentiel

### 15.2 Skip conditionnel (paie si ≥ 3 employés)

```json
{
  "id": "e4",
  "from": { "node": "tax_calc", "port": "taxDue" },
  "to":   { "node": "payroll",  "port": "taxBase" },
  "condition": {
    "dsl": "jsonlogic",
    "expression": { ">=": [{ "var": "input.employeeCount" }, 3] },
    "scope": "full-context"
  }
}
```

Si `input.employeeCount < 3` → edge inactive → nœud `payroll` skippé automatiquement.

### 15.3 Initialisation complète en production

```ts
const resolver = new CachedRuleResolver(
  new TimeoutRuleResolver(
    new RetryRuleResolver(
      new CompositeRuleResolver([
        new RemoteRuleResolver(fiscalDbClient),
        new RemoteRuleResolver(payrollDbClient),
      ]),
      { attempts: 3, backoffMs: 100 }
    ),
    5_000
  ),
  { maxEntries: 1000, ttlMs: 300_000 }
)

const engine      = new PPEEngine({ plugins: [fiscalPlugin, payrollPlugin], dsls: [jsonlogicDSL] })
const orchestrator = new DGOrchestrator(
  new CoreNodeExecutor(engine, resolver),
  engine.getDSLRegistry(),
  {
    logLevel: 'standard',
    limits: { maxNodes: 500, maxDepth: 50, maxEvents: 10_000, maxDurationMs: 30_000, maxParallelNodes: 20 },
    hooks: {
      afterGraph: async (result) => telemetry.record('dg.execution', { durationMs: result.durationMs, status: result.status })
    }
  }
)
```

---

## 16. Roadmap d'implémentation

### Phase 1 — MVP (semaine 1-2)

- [ ] Types complets (graph, ports, policy, events, result)
- [ ] `DGCompiler` étapes 0–5
- [ ] `DGContext` : namespace enforced, append-only, event log (logLevel standard)
- [ ] `DGOrchestrator` : boucle principale + `parallelWithLimit`
- [ ] `CoreNodeExecutor` : idempotence via `nodeExecutionId`
- [ ] `StaticRuleResolver`
- [ ] Tests unitaires compiler étapes 0–5, context, idempotence

### Phase 2 — Robustesse (semaine 3-4)

- [ ] `DGCompiler` étapes 6–8 (policies, hash, DSL variables)
- [ ] `NodePolicy` complet : `fallback`, `skip`, `halt`, propagation, `maxOutputSizeKb`
- [ ] `MergeRunner` : `wait-all`, `wait-any`, `wait-quorum` + `onPartialInputs`
- [ ] Edge conditions `source-output` + `full-context`
- [ ] `CachedRuleResolver` + `RetryRuleResolver` + `TimeoutRuleResolver`
- [ ] `ExecutionLimits` runtime (`maxEvents`, `maxDurationMs`, `maxParallelNodes`)
- [ ] Tests d'intégration : policy matrix, merge strategies, failure propagation

### Phase 3 — Production (semaine 5-6)

- [ ] `RemoteRuleResolver` + `CompositeRuleResolver`
- [ ] Context streaming (`EventEmitter` + `pipe()`)
- [ ] `DGLifecycleHooks`
- [ ] `DGInspector` complet : `explainNode`, `criticalPath`, `replayUntil`, `verify`, `toMermaid`
- [ ] Intégration `@run-iq/server` : endpoints `/graph/*` + cache Redis par hash
- [ ] Tests de performance

### Phase 4 — Intelligence (semaine 7-8)

- [ ] `MCPRuleResolver`
- [ ] Outils MCP : `compile_graph`, `execute_graph`, `inspect_graph_result`, `visualize_graph`, `replay_execution`
- [ ] CLI : `dg compile`, `dg run`, `dg inspect`, `dg trace`, `dg critical`, `dg replay`, `dg verify`, `dg viz`
- [ ] Visualisation playground web (nœuds colorés par statut)

---

## 17. Contrats de test

Les tests d'intégration sont la **spec exécutable** de ce document.

### Compiler — unitaires

```ts
// Étape 0
✓ rejette nodeId avec point ("tax.calc")
✓ rejette nodeId avec espace
✓ rejette portName avec caractère spécial
✓ accepte [a-zA-Z0-9_-]

// Étape 1
✓ rejette edge référençant nodeId inexistant
✓ rejette edge référençant port inexistant
✓ rejette nœud compute sans model
✓ rejette merge wait-quorum sans quorum
✓ rejette nœud fallback sans valeurs fallback

// Étape 2
✓ rejette cycle direct (A → B → A)
✓ rejette cycle indirect (A → B → C → A)
✓ inclut le chemin dans DGCycleError

// Étape 3
✓ niveaux topologiques corrects
✓ merge nodes dans mergeNodes
✓ rejette si > maxNodes
✓ rejette si > maxDepth

// Étape 5
✓ FailurePropagationMap correcte
✓ liste tous les descendants transitifs

// Étape 6
✓ rejette skip + wait-all (deadlock)
✓ warning pour quorum + full-context
✓ warning si > 3 nœuds storeRaw

// Étape 8
✓ erreur variable même niveau (race condition)
✓ warning variable non trouvée
✓ accepte variables niveaux inférieurs
✓ accepte input.* et meta.*
```

### Context — unitaires

```ts
✓ DGConflictError si deux nœuds écrivent la même clé
✓ get() cherche intermediate puis input
✓ namespace enforced — clés sans préfixe refusées
✓ logLevel minimal — 3 events seulement
✓ logLevel verbose — tous les events
✓ streaming pipe envoie events à l'emitter
✓ levelSnapshot() retourne l'état au niveau donné
```

### Orchestrateur — unitaires

```ts
// Parallélisme
✓ nœuds du même niveau exécutés en parallèle
✓ parallélisme limité à maxParallelNodes
✓ merge nodes séquentiels après leur niveau

// Edge conditions
✓ skip si condition false (source-output)
✓ skip si condition false (full-context)
✓ active si condition true
✓ throw si DSL inconnu

// Failure
✓ halt stoppe tout
✓ skip-descendants skippe tous les descendants
✓ continue — descendants utilisent defaults
✓ fallback injecté si onError: 'fallback'
✓ DGOutputSizeError si output > maxOutputSizeKb
✓ DGLimitError si maxEvents dépassé
✓ DGLimitError si maxDurationMs dépassé

// Merge
✓ wait-all attend tous les parents actifs
✓ wait-any s'exécute dès le premier parent
✓ wait-quorum(2/3) s'exécute avec 2 parents
✓ proceed-with-available continue sans parent échoué
✓ use-defaults utilise les defaults des ports
✓ quorum calculé sur edges actives uniquement
```

### Idempotence — intégration

```ts
✓ même requestId + même input → même DGResult
✓ nodeExecutionId = graphRequestId:nodeId
✓ retry avec même requestId → pas de double exécution Core
```

### Inspector — unitaires

```ts
✓ explainNode retourne la bonne raison pour un skip
✓ explainNode liste les edges inactives
✓ criticalPath identifie le chemin le plus lent
✓ replayUntil reconstruit l'état jusqu'au nœud
✓ replayUntil reconstruit l'état jusqu'au niveau
✓ verify retourne reproducible: true pour résultat conforme
✓ toMermaid produit un diagramme valide
✓ toMermaid inclut statut des nœuds si result fourni
```

### Policy matrix — intégration

```ts
// Chaque ligne de la matrice §11
✓ fail + halt → graphe stoppé
✓ fail + skip-descendants + wait-all + fail → merge échoue
✓ fail + continue + wait-all + proceed → merge continue
✓ skip + continue + wait-all → DEADLOCK rejeté au compile-time
✓ skip + continue + wait-any → merge s'exécute
✓ fallback + continue + wait-all → fallback injecté, merge attend
// ... toutes les combinaisons valides
```

---

*Ce document est la source de vérité pour l'implémentation de `@run-iq/dg`.*  
*Toute déviation doit être discutée et documentée ici avant d'être codée.*