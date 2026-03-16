# `@run-iq/dg` — Decision Graph
## Architecture Document v3.0

> **Statut** : Référence définitive pour l'implémentation  
> **Version du document** : 3.0.0  
> **Package** : `@run-iq/dg`  
> **Dépendances Run-IQ** : `@run-iq/context-engine`, `@run-iq/core`, `@run-iq/plugin-sdk`  
> **Prérequis** : lire `context-engine-ARCHITECTURE.md` avant ce document

---

## Table des matières

1. [Pourquoi le Decision Graph existe](#1-pourquoi-le-decision-graph-existe)
2. [Ce que le DG n'est pas](#2-ce-que-le-dg-nest-pas)
3. [Paradigme fondamental : dataflow machine](#3-paradigme-fondamental--dataflow-machine)
4. [Position dans l'écosystème Run-IQ](#4-position-dans-lécosystème-run-iq)
5. [Vue d'ensemble des couches](#5-vue-densemble-des-couches)
6. [Couche 1 — DGGraph (data pure)](#6-couche-1--dggraph-data-pure)
7. [Couche 2 — DGCompiler (9 étapes)](#7-couche-2--dgcompiler-9-étapes)
8. [Couche 3 — DGContext (étend EvaluationContext)](#8-couche-3--dgcontext-étend-evaluationcontext)
9. [Couche 4 — DGOrchestrator](#9-couche-4--dgorchestrator)
10. [Couche 5 — NodeExecutor & RuleResolver](#10-couche-5--nodeexecutor--ruleresolver)
11. [Couche 6 — DGInspector & Replay](#11-couche-6--dginspector--replay)
12. [Matrice des effets combinés](#12-matrice-des-effets-combinés)
13. [Idempotence & déterminisme](#13-idempotence--déterminisme)
14. [Intégration avec l'écosystème Run-IQ](#14-intégration-avec-lécosystème-run-iq)
15. [Structure du package](#15-structure-du-package)
16. [Cas d'usage concrets](#16-cas-dusage-concrets)
17. [Roadmap d'implémentation](#17-roadmap-dimplémentation)
18. [Contrats de test](#18-contrats-de-test)

---

## 1. Pourquoi le Decision Graph existe

### Le problème

Le Core Run-IQ (`@run-iq/core`) est un moteur d'exécution **pur, stateless et déterministe**. Il prend un ensemble de règles et un input, retourne un résultat. C'est sa seule responsabilité.

Mais les domaines régulés réels ne fonctionnent pas en isolation. Une déclaration fiscale au Togo implique simultanément :

- Le calcul de l'IRPP (plugin fiscal)
- Le calcul des obligations sociales CNSS (plugin paie)
- La vérification de conformité TVA (plugin fiscal)
- L'assemblage d'un rapport consolidé

Ces calculs ont des **dépendances entre eux** : la paie dépend du résultat fiscal, le rapport dépend des deux. Certains sont parallèles, d'autres séquentiels. Certains doivent être skippés si une condition n'est pas remplie.

Le Core ne peut pas gérer ça. Le `server` ne doit pas le gérer. Les plugins ne peuvent pas se parler. **Il manque une couche d'orchestration.**

### La solution

Le Decision Graph est cette couche. Il modélise un workflow multi-plugins comme un **graphe dirigé acyclique (DAG)** où :

- Chaque **nœud** représente une unité de calcul (appel au Core)
- Chaque **edge** représente une dépendance de données entre nœuds
- Le **DGContext** — qui étend `EvaluationContext` de `@run-iq/context-engine` — est l'unique vecteur de données circulant dans le graphe

Le DG **orchestre** sans jamais **connaître** la logique métier.

---

## 2. Ce que le DG n'est pas

| Ce que le DG ne fait PAS | Qui le fait |
|---|---|
| Gérer l'état d'exécution des données | `@run-iq/context-engine` — `EvaluationContext` |
| Définir les contrats de persistance | `@run-iq/context-engine` — `GraphStore`, `RuleStore`, `ExecutionStore` |
| Connaître la logique fiscale, sociale | Les plugins |
| Exécuter les modèles de calcul | `@run-iq/core` — `PPEEngine` |
| Persister en base de données | L'application host via `PersistenceAdapter` |
| Interpréter les meta-rules fiscales | Le plugin fiscal via `beforeEvaluate` |
| Exposer une API HTTP | `@run-iq/server` |
| Générer des graphes depuis du texte | MCP server + LLM |
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
  ├─ Étape 4 : résolution wiring            ├─ Propagation des erreurs O(1)
  ├─ Étape 5 : FailurePropagationMap        ├─ Streaming events DG
  ├─ Étape 6 : validation politiques        ├─ Persistence via PersistenceAdapter
  ├─ Étape 7 : hash SHA-256                 └─ Enforcement des limites runtime
  └─ Étape 8 : analyse variables DSL
```

**Compiler une fois, exécuter N fois.** Le `CompiledGraph` est sérialisable, cacheable via `GraphStore`, identifiable par son hash SHA-256.

---

## 4. Position dans l'écosystème Run-IQ

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          Application Host                                 │
│   PostgresGraphStore   PostgresRuleStore   PostgresExecutionStore         │
│   → implémentent les interfaces de @run-iq/context-engine                │
└────────────────────────────┬─────────────────────────────────────────────┘
                             │ injecte PersistenceAdapter
┌────────────────────────────▼─────────────────────────────────────────────┐
│                        @run-iq/server                                     │
│   POST /graph/compile  POST /graph/execute  GET /execution/:id/state      │
└──────────────┬──────────────────────────────┬────────────────────────────┘
               │                              │
┌──────────────▼──────────┐    ┌──────────────▼──────────────────────────┐
│      @run-iq/dg          │    │         @run-iq/mcp-server               │
│                          │    │   peut lire EvaluationContext            │
│  DGContext               │    │   directement (lecture du contexte live) │
│    extends               │    └─────────────────────────────────────────┘
│  EvaluationContext       │
│  + DGEvent log           │
│  + levelSnapshot()       │
│  + buildResult()         │
│  + streaming events      │
└──────────────┬──────────┘
               │ dépend de
┌──────────────▼──────────────────────────────────────────────────────────┐
│                    @run-iq/context-engine                                 │
│   EvaluationContext    PersistenceAdapter    ContextLifecycleHooks        │
│   GraphStore (if.)     RuleStore (if.)       ExecutionStore (if.)         │
│   InMemory adapters    ContextSnapshot       ExecutionMeta                │
│   ← ZÉRO dépendance Run-IQ →                                             │
└──────────────┬──────────────────────────────────────────────────────────┘
               │ dépend de
┌──────────────▼──────────────────────────────────────────────────────────┐
│                       @run-iq/core                                        │
│   PPEEngine    DSLEvaluator    Rule    EvaluationResult                   │
└──────────────┬──────────────────────────────────────────────────────────┘
               │ utilise
┌──────────────▼──────────────────────────────────────────────────────────┐
│                      Plugins                                              │
│   plugin-fiscal │ plugin-payroll │ plugin-* (custom)                     │
└──────────────────────────────────────────────────────────────────────────┘
```

### Règle de dépendances du DG

```
@run-iq/dg dépend de :
  ├── @run-iq/context-engine  (EvaluationContext, PersistenceAdapter, stores interfaces)
  └── @run-iq/core            (PPEEngine, DSLEvaluator, Rule, EvaluationResult)

@run-iq/dg ne dépend PAS de :
  ├── @run-iq/server          (jamais)
  ├── @run-iq/mcp-server      (jamais)
  └── @run-iq/plugin-*        (jamais — les plugins passent par le Core)
```

---

## 5. Vue d'ensemble des couches

```
@run-iq/dg
│
├── Couche 1 : DGGraph          — Le graphe comme data pure (JSON serializable)
├── Couche 2 : DGCompiler       — Validation + compilation statique (9 étapes)
├── Couche 3 : DGContext        — Étend EvaluationContext (@run-iq/context-engine)
│                                  Ajoute : DGEvent log, streaming, buildResult()
├── Couche 4 : DGOrchestrator   — Scheduling, parallélisme limité, merges, erreurs
│                                  Utilise : PersistenceAdapter pour l'audit
├── Couche 5 : NodeExecutor     — Interface vers Core (idempotente via nodeExecutionId)
│             RuleResolver      — Static / Remote / MCP / Cached / Retry / Timeout
│                                  (RuleStore de context-engine = implémentation DB)
└── Couche 6 : DGInspector      — Debug, audit, replay, visualisation (stateless)
```

### Relation DGContext / EvaluationContext

```
@run-iq/context-engine
└── EvaluationContext
      ├── state: Map<string, unknown>    ← gestion données
      ├── set() / get() / setRaw()       ← namespace enforced, append-only
      ├── snapshot()                     ← photos immuables
      ├── limits: ContextLimits          ← protection mémoire
      ├── hooks: ContextLifecycleHooks   ← observation
      └── adapter: PersistenceAdapter    ← persistance optionnelle

@run-iq/dg
└── DGContext extends EvaluationContext
      ├── [hérite de tout EvaluationContext]
      ├── eventLog: DGEvent[]            ← log DG-spécifique
      ├── eventCount: number             ← enforcement maxEvents
      ├── streaming?: EventEmitter       ← stream temps réel
      ├── emit(event: DGEvent)           ← écriture dans le log + streaming + persistence
      ├── isSkipped(nodeId): boolean     ← état DG d'un nœud
      ├── isFailed(nodeId): boolean      ← état DG d'un nœud
      ├── isEdgeInactive(edgeId): bool   ← état DG d'une edge
      ├── levelSnapshot(level): DGLevelSnapshot
      └── buildResult(compiled): DGResult
```

---

## 6. Couche 1 — DGGraph (data pure)

### 6.1 Contraintes de nommage

La même regex que dans `@run-iq/context-engine` — appliquée ici au niveau du compilateur, avant même que les données entrent dans le contexte.

```ts
const IDENTIFIER_PATTERN = /^[a-zA-Z0-9_-]+$/
```

Appliquée à **tous** les identifiants : `nodeId`, `portName`, `edgeId`, `graphId`. Détectée en Étape 0 du compilateur.

**Pourquoi la même règle** : le compilateur et le contexte doivent être d'accord sur ce qu'est un identifiant valide. Si le compilateur accepte `tax.calc` comme nodeId mais que `EvaluationContext.set()` le rejette, l'exécution échoue à runtime avec une erreur obscure. La cohérence est garantie par le partage de la même contrainte.

### 6.2 Convention de namespace des clés — rappel

Définie dans `@run-iq/context-engine`. Répétée ici pour référence.

| Source | Format | Exemple |
|---|---|---|
| Input initial | `input.<key>` | `input.income` |
| Output d'un nœud | `<nodeId>.<portName>` | `tax_calc.taxDue` |
| Raw d'un nœud | `<nodeId>.__raw` | `tax_calc.__raw` |
| Sous-champ du raw | résolu dynamiquement | `tax_calc.__raw.breakdown.TVA` |

### 6.3 DGGraph

```ts
interface DGGraph {
  id:      string          // regex ^[a-zA-Z0-9_-]+$
  version: string          // semver
  nodes:   Record<string, DGNode>
  edges:   DGEdge[]
  meta?:   GraphMeta
}

interface GraphMeta {
  description?:     string
  domain?:          string
  author?:          string
  tags?:            string[]
  executionLimits?: ExecutionLimits
}
```

### 6.4 DGNode

```ts
interface DGNode {
  id:     string
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
| `guard` | Valide les inputs, peut halter | Non | Non |
| `merge` | Attend N parents, fusionne leurs outputs | Optionnel | Oui |

#### NodePorts

```ts
interface NodePorts {
  in:  PortDescriptor[]
  out: PortDescriptor[]
}

interface PortDescriptor {
  name:       string
  required:   boolean
  schema?:    JSONSchema
  default?:   unknown
}
```

**Principe du moindre privilège** : un nœud ne voit que ce qu'il déclare dans `ports.in`. L'orchestrateur passe exactement `extractInputs(node, wiring, ctx)` — jamais le contexte global entier.

#### NodePolicy

```ts
interface NodePolicy {
  onError:            'fail' | 'skip' | 'fallback'
  fallback?:          Record<string, unknown>   // requis si onError = 'fallback'
  timeout?:           number                    // ms — déclenche DGTimeoutError
  onFailPropagation:  'halt' | 'skip-descendants' | 'continue'
  storeRaw?:          boolean                   // défaut: false
  maxOutputSizeKb?:   number                    // défaut: 512
}
```

**`storeRaw`** : si `true`, `result.raw` du Core est passé à `ctx.setRaw(nodeId, raw)` de `EvaluationContext`. La taille est vérifiée par `maxOutputSizeKb` **avant** l'appel à `setRaw()`. Warning compilateur si > 3 nœuds ont `storeRaw: true` dans un même graphe.

**`maxOutputSizeKb`** : vérifié dans `injectOutputs()` via `roughSizeKb()` de `@run-iq/context-engine`. Protège contre les outputs volumineux légitimes (ex: `invoices: Invoice[]` avec 1000 lignes).

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

### 6.5 DGEdge

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
  dsl:        string          // doit être dans DSLRegistry du Core
  expression: unknown
  scope:      'source-output' | 'full-context'
}
```

**`source-output`** : le contexte d'évaluation est `ctx.getNodeOutputs(edge.from.node)` — outputs du nœud source uniquement.

**`full-context`** : le contexte d'évaluation est `ctx.getFullState()` — état complet. Permet des conditions croisant plusieurs nœuds. Les deux méthodes viennent directement de `EvaluationContext`.

> **Contrainte compile-time (Étape 8)** : les variables d'une expression `full-context` doivent être produites par des nœuds de niveau topologique **strictement inférieur** au nœud destination. Détectée statiquement — race condition impossible si le graphe compile.

### 6.6 MergeNodeConfig

```ts
interface MergeNodeConfig {
  strategy:        'wait-all' | 'wait-any' | 'wait-quorum'
  quorum?:         number    // requis si wait-quorum — 1 ≤ quorum ≤ nbParents
  onPartialInputs: 'fail' | 'proceed-with-available' | 'use-defaults'
}
```

Déclarée dans `node.meta.mergeConfig`. Le quorum s'applique sur les parents dont l'edge entrante est **active au runtime** — pas sur tous les parents déclarés.

### 6.7 ExecutionLimits

```ts
interface ExecutionLimits {
  maxNodes?:         number   // défaut: 500  — compile-time
  maxDepth?:         number   // défaut: 50   — compile-time
  maxEvents?:        number   // défaut: 10_000 — runtime (DGContext.emit())
  maxDurationMs?:    number   // défaut: 30_000 — runtime (DGOrchestrator)
  maxParallelNodes?: number   // défaut: 20   — semaphore dans Promise.all
}
```

`maxNodes` et `maxDepth` sont vérifiés par le compilateur. `maxEvents` est vérifié dans `DGContext.emit()`. `maxDurationMs` et `maxParallelNodes` sont vérifiés par l'orchestrateur.

---

## 7. Couche 2 — DGCompiler (9 étapes)

### 7.1 Interface

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
  hash:      string    // sha256() de @run-iq/context-engine/utils
  compiled:  {
    at:                   string
    dgVersion:            string    // version de @run-iq/dg
    contextEngineVersion: string    // version de @run-iq/context-engine — reproductibilité
    coreVersion:          string    // version de @run-iq/core — compatibilité des Rules
  }
}

interface ExecutionLevel {
  index:      number
  nodes:      string[]      // parallèle (limité par maxParallelNodes)
  mergeNodes: string[]      // séquentiel après nodes
}
```

**Note** : `sha256()` utilisé pour le hash est importé de `@run-iq/context-engine/utils` — pas de dépendance crypto séparée dans `@run-iq/dg`.

### 7.2 Les 9 étapes

#### Étape 0 — Validation des identifiants

Même regex que `EvaluationContext.validateIdentifier()` — garantit que tout ce qui compile peut être stocké dans le contexte sans `ContextValidationError` à runtime.

```ts
const IDENTIFIER_PATTERN = /^[a-zA-Z0-9_-]+$/
// Vérifie : graph.id, tous les nodeId, tous les portName, tous les edgeId
```

#### Étape 1 — Validation structurelle

- Edges : `from.node`, `to.node`, `from.port`, `to.port` référencent des éléments existants
- Nœuds `compute` : `model` non vide
- Nœuds `merge` + `wait-quorum` : `quorum` défini et valide (1 ≤ quorum ≤ nb parents)
- Nœuds avec `onError: 'fallback'` : `fallback` défini avec les bonnes clés

#### Étape 2 — Détection de cycles

Algorithme de Kahn (BFS). Tout cycle → `DGCycleError` avec le chemin complet.

```
DGCycleError: Cycle detected: tax_calc → payroll → summary → tax_calc
```

#### Étape 3 — Tri topologique par niveaux

```ts
interface ExecutionLevel {
  index:      number
  nodes:      string[]      // nœuds normaux — exécutés en parallèle
  mergeNodes: string[]      // exécutés séquentiellement après nodes
}
```

Les nœuds `merge` sont toujours dans `mergeNodes` — ils attendent leurs parents du même niveau.

> **Design décision — level-based, not dependency-based** : le DG v1 est level-based. Un merge attend la fin de son niveau complet, même s'il ne dépend que d'un sous-ensemble. Ce design simplifie l'ordonnancement et évite des cas limites subtils (race conditions, réordonnancements non-déterministes).
>
> **Optimisation v1** : placer le merge dans un niveau séparé pour qu'il ne bloque que sur ses dépendances réelles.
>
> **Évolution future (v2)** : un mode `scheduling: 'dependency-based'` dans `ExecutionLimits` permettrait au merge d'attendre uniquement ses parents directs, sans attendre la fin du niveau complet. Ce mode serait activé explicitement — le mode level-based reste le défaut pour sa simplicité et sa prévisibilité.

Vérification compile-time : `maxNodes`, `maxDepth`.

#### Étape 4 — Résolution du wiring

```ts
interface PortWiring {
  fromNode:   string
  fromPort:   string
  toNode:     string
  toPort:     string
  aliasedAs?: string    // portAlias sur l'edge
}

type WiringMap = Map<string, PortWiring[]>    // indexée par toNodeId
```

Précalculée une fois. `extractInputs()` fait une lookup directe — pas de traversée du graphe à hot path.

#### Étape 5 — FailurePropagationMap

```ts
type FailurePropagationMap = Map<
  string,
  { policy: 'halt' | 'skip-descendants' | 'continue'; descendants: string[] }
>
```

DFS depuis chaque nœud. Lookup `O(1)` au runtime au lieu de `O(N)` par erreur.

#### Étape 6 — Validation des politiques (deadlocks)

**Erreur bloquante** :

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
- Plus de 3 nœuds avec `storeRaw: true` (surcharge du contexte)

#### Étape 7 — Hash SHA-256

```ts
// sha256 importé de @run-iq/context-engine/utils
const hash = sha256(JSON.stringify({
  id:      graph.id,
  version: graph.version,
  nodes:   graph.nodes,
  edges:   graph.edges
}))
```

Le hash est la clé de cache dans `GraphStore.saveCompiledGraph()` / `getCompiledGraph()`.

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

type DSLVariableMap = Map<string, DSLVariableAnalysis>
```

Pour chaque edge avec condition : extraire les variables (walk JSONLogic `{ "var": "..." }`, parser léger CEL), vérifier que chaque producteur est à un niveau **strictement inférieur**.

**Erreur** : variable produite par un nœud de même niveau ou supérieur — race condition garantie.
**Warning** : variable non trouvée dans aucun nœud — peut venir de `meta.context`.

---

## 8. Couche 3 — DGContext (étend EvaluationContext)

### 8.1 Relation avec EvaluationContext

`DGContext` étend `EvaluationContext` de `@run-iq/context-engine`. Il hérite de **tout** : namespace, append-only, get/set/setRaw, snapshots, limits, hooks, adapter. Il y ajoute uniquement ce qui est DG-spécifique : le log d'events, le streaming temps réel, et la construction du résultat final.

```ts
import {
  EvaluationContext,
  EvaluationContextOptions,
  ExecutionMeta,
  ContextSnapshot
} from '@run-iq/context-engine'

interface DGContextOptions extends EvaluationContextOptions {
  logLevel?:           LogLevel
  streaming?:          EventEmitter
  onPersistenceError?: (error: unknown) => void  // called when ExecutionStore fails — never console.*
  // limits et adapter sont hérités de EvaluationContextOptions
}

class DGContext extends EvaluationContext {

  private readonly eventLog:   DGEvent[]    = []
  private          eventCount: number       = 0
  private readonly skippedNodes: Set<string> = new Set()
  private readonly failedNodes:  Set<string> = new Set()
  private readonly inactiveEdges: Set<string> = new Set()
  private readonly levelStartTimes: Map<number, number> = new Map()

  constructor(
    input:   Readonly<Record<string, unknown>>,
    meta:    ExecutionMeta,
    private readonly dgOptions: DGContextOptions = {}
  ) {
    // Passe limits, hooks et adapter à EvaluationContext
    super(input, meta, {
      limits:  dgOptions.limits,
      hooks:   dgOptions.hooks,
      adapter: dgOptions.adapter
    })
  }

  // ─── DGEvent — log spécifique au DG ──────────────────────────────────────

  emit(event: DGEvent): void {
    if (!this.shouldLog(event.type)) return

    this.eventCount++
    const maxEvents = this.dgOptions.limits?.maxEvents ?? 10_000
    if (this.eventCount > maxEvents) {
      throw new DGLimitError(`maxEvents (${maxEvents}) exceeded`)
    }

    const frozenEvent = Object.freeze(event)
    this.eventLog.push(frozenEvent)

    // Streaming temps réel — pour les clients qui observent l'exécution live
    this.dgOptions.streaming?.emit('dg:event', frozenEvent)

    // Persistence asynchrone via ExecutionStore (si adapter présent)
    // Note : fire-and-forget — on ne bloque pas l'exécution sur la persistence
    this.dgOptions.adapter?.executions?.recordEvent(
      this.meta.requestId,
      {
        executionId: this.meta.requestId,
        sequence:    this.eventCount,
        type:        event.type,
        payload:     JSON.stringify(event),
        recordedAt:  new Date().toISOString()
      }
    ).catch(err => {
      // Erreur de persistence → callback uniquement, jamais fatal pour l'exécution
      // Zéro console.* — le caller décide comment logger
      this.dgOptions.onPersistenceError?.(err)
    })

    // Tracking état des nœuds pour isSkipped/isFailed
    if (event.type === 'node.skipped') this.skippedNodes.add(event.nodeId)
    if (event.type === 'node.failed')  this.failedNodes.add(event.nodeId)
    if (event.type === 'edge.inactive') this.inactiveEdges.add(event.edgeId)
    if (event.type === 'level.started') this.levelStartTimes.set(event.level, Date.now())
  }

  // ─── État DG des nœuds ────────────────────────────────────────────────────

  isSkipped(nodeId: string):     boolean { return this.skippedNodes.has(nodeId) }
  isFailed(nodeId: string):      boolean { return this.failedNodes.has(nodeId) }
  isCompleted(nodeId: string):   boolean { return this.has(`${nodeId}.__completed`) }
  isEdgeInactive(edgeId: string): boolean { return this.inactiveEdges.has(edgeId) }

  markCompleted(nodeId: string): void {
    // Flag interne — pas dans le namespace EvaluationContext
    // Utilisé par MergeRunner pour identifier les parents prêts
    this.completedNodes.add(nodeId)
  }

  private readonly completedNodes: Set<string> = new Set()

  // ─── Snapshot niveau ──────────────────────────────────────────────────────

  levelSnapshot(level: number): DGLevelSnapshot {
    const startTime = this.levelStartTimes.get(level) ?? 0
    const snap = this.snapshot(`after-level-${level}`)  // snapshot EvaluationContext

    return {
      level,
      stateAtLevel: snap.state,
      events:       this.eventLog.filter(e => new Date(e.ts).getTime() >= startTime)
    }
  }

  // ─── Résultat final ───────────────────────────────────────────────────────

  buildResult(compiled: CompiledGraph): DGResult {
    const graphCompleted = this.eventLog.find(
      (e): e is Extract<DGEvent, { type: 'graph.completed' }> => e.type === 'graph.completed'
    )

    return {
      graphId:    compiled.source.id,
      graphHash:  compiled.hash,
      requestId:  this.meta.requestId,
      status:     graphCompleted?.status ?? 'failed',
      outputs:    this.getFullState(),
      executed:   [...this.completedNodes],
      skipped:    [...this.skippedNodes],
      failed:     [...this.failedNodes],
      events:     Object.freeze([...this.eventLog]),
      durationMs: graphCompleted?.durationMs ?? 0
    }
  }

  // ─── LogLevel filter ──────────────────────────────────────────────────────

  private shouldLog(type: DGEvent['type']): boolean {
    const level = this.dgOptions.logLevel ?? 'standard'
    if (level === 'verbose') return true
    if (level === 'minimal') {
      return ['graph.started', 'node.failed', 'graph.completed'].includes(type)
    }
    // standard — tout sauf les events verbeux
    return !['edge.inactive', 'merge.waiting', 'node.raw_stored'].includes(type)
  }
}
```

### 8.2 DGEvent — le log immuable

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
  | { type: 'level.completed';  level: number; durationMs: number; ts: string }
  | { type: 'graph.completed';  status: DGStatus; durationMs: number; ts: string }

type SkipReason =
  | 'edge-condition-false'
  | 'parent-failed-propagation'
  | 'guard-rejected'
  | 'merge-partial-inputs-failed'
  | 'timeout'

type DGStatus = 'completed' | 'failed' | 'partial'
type LogLevel = 'minimal' | 'standard' | 'verbose'
```

#### LogLevel

| Level | Events enregistrés | Usage |
|---|---|---|
| `minimal` | `graph.started`, `node.failed`, `graph.completed` | Production haute charge |
| `standard` | + `node.started/completed/skipped/fallback`, `level.*` | Production normale |
| `verbose` | Tout | Debug, audit légal |

### 8.3 DGResult

```ts
interface DGResult {
  graphId:    string
  graphHash:  string                          // SHA-256 — identifie exactement la version exécutée
  requestId:  string
  status:     DGStatus
  outputs:    Readonly<Record<string, unknown>>  // état complet du contexte (via getFullState())
  executed:   string[]
  skipped:    string[]
  failed:     string[]
  events:     readonly DGEvent[]
  durationMs: number
  versions:   {                               // reproductibilité — quelles versions ont produit ce résultat
    dg:            string
    contextEngine: string
    core:          string
  }
}
```

---

## 9. Couche 4 — DGOrchestrator

### 9.1 Interface publique

```ts
interface DGOrchestratorOptions {
  logLevel?:   LogLevel
  streaming?:  EventEmitter
  limits?:     ExecutionLimits
  hooks?:      DGLifecycleHooks
  adapter?:    PersistenceAdapter    // de @run-iq/context-engine — passé à DGContext
}

class DGOrchestrator {
  constructor(
    private executor: NodeExecutor,
    private dsls:     Map<string, DSLEvaluator>,
    private options?: DGOrchestratorOptions
  ) {}

  async execute(
    compiled: CompiledGraph,
    input:    Record<string, unknown>,
    meta:     ExecutionMeta              // ExecutionMeta de @run-iq/context-engine
  ): Promise<DGResult>
}
```

**Injection des DSLEvaluators** : le DG consomme la `Map<string, DSLEvaluator>` initialisée par le `PPEEngine`. Jamais redéfinis dans le DG.

**PersistenceAdapter** : reçu dans `options.adapter`, passé au constructeur de `DGContext`. L'orchestrateur ne persiste jamais lui-même — il délègue via le contexte.

### 9.2 Initialisation de l'exécution

```ts
async execute(compiled, input, meta): Promise<DGResult> {
  // Création du DGContext — EvaluationContext + plomberie DG
  const ctx = new DGContext(input, meta, {
    logLevel:  this.options?.logLevel,
    streaming: this.options?.streaming,
    limits:    this.options?.limits,
    hooks:     this.options?.hooks?.contextHooks,
    adapter:   this.options?.adapter
  })

  // Démarrer l'exécution dans l'ExecutionStore si adapter présent
  await this.options?.adapter?.executions?.startExecution({
    executionId:  meta.requestId,
    requestId:    meta.requestId,
    tenantId:     meta.tenantId,
    userId:       meta.userId,
    graphId:      compiled.source.id,
    graphHash:    compiled.hash,
    graphVersion: compiled.source.version,
    startedAt:    new Date().toISOString(),
    status:       'running'
  })

  const startTime = Date.now()
  ctx.emit({ type: 'graph.started', graphId: compiled.source.id, hash: compiled.hash, requestId: meta.requestId, ts: now() })

  await this.options?.hooks?.beforeGraph?.(compiled, meta)

  // ... boucle d'exécution par niveaux ...
}
```

### 9.3 Algorithme d'exécution

```
pour chaque level dans compiled.levels:
  emit level.started

  // 1. Résoudre les nœuds actifs (edge conditions)
  activeNodes = await resolveActiveNodes(level.nodes, compiled, ctx)

  // 2. Exécuter les nœuds actifs en parallèle (limité par semaphore)
  await parallelWithLimit(
    activeNodes.map(id => () => runNode(nodes[id], compiled, ctx)),
    options.limits?.maxParallelNodes ?? 20
  )

  // 3. Exécuter les merge nodes séquentiellement
  pour chaque mergeId dans level.mergeNodes:
    if nodeIsActive(mergeId, compiled, ctx):
      await runMerge(nodes[mergeId], compiled, ctx)
    else:
      ctx.emit { type: 'node.skipped', reason: 'edge-condition-false' }

  // 4. Vérifier la limite de durée
  if (Date.now() - startTime > limits.maxDurationMs):
    throw new DGLimitError('maxDurationMs exceeded')

  emit level.completed

// Finalisation
emit graph.completed
await adapter?.executions?.completeExecution(meta.requestId, summary)
await hooks?.afterGraph?.(result)
return ctx.buildResult(compiled)
```

### 9.4 Parallélisme limité

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

### 9.5 Résolution des nœuds actifs

Un nœud est actif si toutes ses edges entrantes sont actives. Une edge est active si elle n'a pas de condition, ou si sa condition évalue à `true`.

```ts
private async resolveActiveNodes(nodeIds, compiled, ctx): Promise<string[]> {
  return (await Promise.all(
    nodeIds.map(async nodeId => {
      const incomingEdges = compiled.source.edges.filter(e => e.to.node === nodeId)
      if (incomingEdges.length === 0) return nodeId   // nœud racine

      for (const edge of incomingEdges) {
        if (!edge.condition) continue

        // Utilise les méthodes d'EvaluationContext directement
        const evalCtx = edge.condition.scope === 'full-context'
          ? ctx.getFullState()           // méthode héritée de EvaluationContext
          : ctx.getNodeOutputs(edge.from.node)   // méthode héritée

        const dsl = this.dsls.get(edge.condition.dsl)
        if (!dsl) throw new DGError(`DSL '${edge.condition.dsl}' not in registry`)

        // evalCtx is Record<string, unknown> from both getFullState() and getNodeOutputs()
        // DSLEvaluator.evaluate() accepts Record<string, unknown> — no cast needed
        const active = dsl.evaluate(edge.condition.expression, evalCtx)
        if (!active) {
          ctx.emit({ type: 'edge.inactive', edgeId: edge.id, scope: edge.condition.scope, evaluated: evalCtx, ts: now() })
          return null
        }
      }
      return nodeId
    })
  )).filter(Boolean) as string[]
}
```

### 9.6 Exécution d'un nœud compute

```ts
private async runNode(node, compiled, ctx): Promise<void> {
  const inputs          = this.extractInputs(node, compiled.wiring, ctx)
  const nodeExecutionId = `${ctx.meta.requestId}:${node.id}`

  ctx.emit({ type: 'node.started', nodeId: node.id, nodeExecutionId, inputs, ts: now() })
  const start = Date.now()

  await this.options?.hooks?.beforeNode?.(node, inputs)

  try {
    const resultPromise = this.executor.execute(node, inputs, ctx.meta)
    const result = node.policy.timeout
      ? await withTimeout(resultPromise, node.policy.timeout, `Node "${node.id}" timed out`)
      : await resultPromise

    // Vérification taille via roughSizeKb de @run-iq/context-engine/utils
    const sizeKb    = roughSizeKb(result.outputs)
    const maxSizeKb = node.policy.maxOutputSizeKb ?? 512
    if (sizeKb > maxSizeKb) {
      throw new DGOutputSizeError(
        `Node "${node.id}" output size ${sizeKb.toFixed(1)}kb exceeds limit ${maxSizeKb}kb`
      )
    }

    // Injection dans EvaluationContext via les méthodes héritées
    this.injectOutputs(node, result, compiled.wiring, ctx)
    if (node.policy.storeRaw && result.raw !== undefined) {
      ctx.setRaw(node.id, result.raw)   // méthode héritée de EvaluationContext
    }

    ctx.markCompleted(node.id)
    ctx.emit({ type: 'node.completed', nodeId: node.id, nodeExecutionId, outputs: result.outputs, durationMs: Date.now() - start, ts: now() })
    await this.options?.hooks?.afterNode?.(node, result)

  } catch (err) {
    await this.handleNodeError(node, err as Error, compiled, ctx)
  }
}
```

### 9.7 injectOutputs & extractInputs

```ts
/**
 * Écrit les outputs d'un nœud dans le contexte.
 * Utilise ctx.set() de EvaluationContext — namespace enforced, append-only.
 */
private injectOutputs(node, result, wiring, ctx: DGContext): void {
  for (const [portName, value] of Object.entries(result.outputs)) {
    ctx.set(node.id, portName, value)   // méthode héritée de EvaluationContext
  }
}

/**
 * Extrait les inputs d'un nœud depuis le contexte selon la wiring map.
 * Utilise ctx.get() de EvaluationContext — résolution en cascade.
 */
private extractInputs(
  node:   DGNode,
  wiring: WiringMap,
  ctx:    DGContext
): Record<string, unknown> {
  const inputs: Record<string, unknown> = {}
  const wirings = wiring.get(node.id) ?? []

  for (const wire of wirings) {
    const key   = wire.aliasedAs ?? wire.fromPort
    const value = ctx.get(`${wire.fromNode}.${wire.fromPort}`)   // méthode héritée

    if (value === undefined) {
      // Cherche un default dans la déclaration du port
      const portDef = node.ports.in.find(p => p.name === key)
      if (portDef?.required) {
        throw new DGMissingInputError(
          `Node "${node.id}" requires input port "${key}" ` +
          `but "${wire.fromNode}.${wire.fromPort}" is absent from context`
        )
      }
      if (portDef?.default !== undefined) {
        inputs[key] = portDef.default
      }
    } else {
      inputs[key] = value
    }
  }

  return inputs
}
```

### 9.8 Gestion des erreurs et propagation

```ts
private async handleNodeError(node, err, compiled, ctx): Promise<void> {
  // Fallback
  if (node.policy.onError === 'fallback' && node.policy.fallback) {
    for (const [portName, value] of Object.entries(node.policy.fallback)) {
      ctx.set(node.id, portName, value)   // EvaluationContext.set()
    }
    ctx.emit({ type: 'node.fallback', nodeId: node.id, fallback: node.policy.fallback, ts: now() })
    ctx.markCompleted(node.id)
    return
  }

  // Skip
  if (node.policy.onError === 'skip') {
    ctx.emit({ type: 'node.skipped', nodeId: node.id, reason: 'edge-condition-false', ts: now() })
    return
  }

  // Fail + propagation
  ctx.emit({
    type: 'node.failed', nodeId: node.id,
    nodeExecutionId: `${ctx.meta.requestId}:${node.id}`,
    error: err.message, propagation: node.policy.onFailPropagation, ts: now()
  })

  const propagation = compiled.failures.get(node.id)!

  switch (node.policy.onFailPropagation) {
    case 'halt':
      throw new DGHaltError(`Node "${node.id}" failed with halt policy: ${err.message}`, err)

    case 'skip-descendants':
      for (const id of propagation.descendants) {
        ctx.emit({ type: 'node.skipped', nodeId: id, reason: 'parent-failed-propagation', ts: now() })
      }
      break

    case 'continue':
      // Descendants utilisent les defaults des ports — extractInputs gère
      break
  }
}
```

### 9.9 Exécution d'un merge node

```ts
private async runMerge(node, compiled, ctx): Promise<void> {
  const config: MergeNodeConfig = node.meta?.mergeConfig ?? {
    strategy: 'wait-all', onPartialInputs: 'fail'
  }

  const parentEdges      = compiled.source.edges.filter(e => e.to.node === node.id)
  const activeParents    = parentEdges.filter(e => !ctx.isEdgeInactive(e.id))
  const completedParents = activeParents.filter(e => ctx.isCompleted(e.from.node))

  const quorumMet =
    config.strategy === 'wait-all'  ? completedParents.length === activeParents.length :
    config.strategy === 'wait-any'  ? completedParents.length >= 1 :
    /* wait-quorum */                 completedParents.length >= (config.quorum ?? activeParents.length)

  if (!quorumMet) {
    ctx.emit({
      type: 'merge.waiting', nodeId: node.id, strategy: config.strategy,
      waiting:  activeParents.filter(e => !ctx.isCompleted(e.from.node)).map(e => e.from.node),
      received: completedParents.map(e => e.from.node), ts: now()
    })

    switch (config.onPartialInputs) {
      case 'fail':
        return this.handleNodeError(node, new DGMergeError(`Quorum not met`), compiled, ctx)
      case 'proceed-with-available':
      case 'use-defaults':
        break   // extractInputs gère les defaults
    }
  }

  // Exécution du merge comme un nœud compute normal
  const mergedInputs = this.extractInputs(node, compiled.wiring, ctx)
  const result       = await this.executor.execute(node, mergedInputs, ctx.meta)
  this.injectOutputs(node, result, compiled.wiring, ctx)
  ctx.markCompleted(node.id)
}
```

### 9.10 DGLifecycleHooks

```ts
interface DGLifecycleHooks {
  // Observation uniquement — ne peuvent pas modifier l'état
  beforeGraph?(compiled: CompiledGraph, meta: ExecutionMeta): Promise<void>
  beforeNode?(node: DGNode, inputs: Record<string, unknown>): Promise<void>
  afterNode?(node: DGNode, result: NodeResult): Promise<void>
  afterGraph?(result: DGResult): Promise<void>
  onError?(node: DGNode, error: Error): Promise<void>

  // Hooks du contexte — passés à EvaluationContext
  contextHooks?: ContextLifecycleHooks    // de @run-iq/context-engine
}
```

---

## 10. Couche 5 — NodeExecutor & RuleResolver

### 10.1 NodeExecutor

```ts
interface NodeExecutor {
  execute(
    node:   DGNode,
    inputs: Record<string, unknown>,
    meta:   ExecutionMeta            // ExecutionMeta de @run-iq/context-engine
  ): Promise<NodeResult>
}

interface NodeResult {
  outputs:    Record<string, unknown>
  raw?:       unknown     // passé à ctx.setRaw() si storeRaw: true
  durationMs: number
}
```

### 10.2 CoreNodeExecutor — idempotence garantie

```ts
class CoreNodeExecutor implements NodeExecutor {
  constructor(private engine: PPEEngine, private resolver: RuleResolver) {}

  async execute(node, inputs, meta): Promise<NodeResult> {
    const start = Date.now()
    const rules = await this.resolver.resolve(node, meta)

    // nodeExecutionId = composition déterministe pour l'idempotence
    // Le Core PPE est idempotent sur requestId — cette composition en hérite
    const nodeExecutionId = `${meta.requestId}:${node.id}`

    const result = await this.engine.evaluate({
      rules,
      input: {
        data:      inputs,
        requestId: nodeExecutionId,
        meta: {
          tenantId:      meta.tenantId,
          effectiveDate: meta.effectiveDate,
          context:       meta.context
        }
      }
    })

    return {
      outputs:    this.mapOutputPorts(node.ports.out, result),
      raw:        result,
      durationMs: Date.now() - start
    }
  }

  private mapOutputPorts(ports: PortDescriptor[], result: EvaluationResult): Record<string, unknown> {
    return Object.fromEntries(
      ports.map(port => [port.name, this.extractPortValue(port, result)])
    )
  }

  /**
   * Extrait la valeur d'un port de sortie depuis l'EvaluationResult du Core.
   *
   * Convention de mapping (par nom) :
   *   - port.name === 'value'     → result.value (résultat agrégé principal)
   *   - port.name === 'breakdown' → result.breakdown (détail par règle, si plugin l'enrichit)
   *   - port.name === 'trace'     → result.trace (audit trail des étapes)
   *   - port.name === 'applied'   → result.appliedRules (règles effectivement exécutées)
   *   - Tout autre nom            → result.pluginData?.[port.name] ?? undefined
   *
   * Si le port est required et la valeur est undefined → DGMissingOutputError.
   * Si le port n'est pas required et la valeur est undefined → omis des outputs.
   *
   * Ce mapping est la frontière entre le Core (EvaluationResult) et le DG (NodeResult.outputs).
   * Il ne transforme pas les données — il les route.
   */
  private extractPortValue(port: PortDescriptor, result: EvaluationResult): unknown {
    switch (port.name) {
      case 'value':     return result.value
      case 'breakdown': return result.breakdown
      case 'trace':     return result.trace
      case 'applied':   return result.appliedRules
      default:          return result.pluginData?.[port.name]
    }
  }
}
```

**Idempotence** : `nodeExecutionId = ${graphRequestId}:${nodeId}` est unique par nœud par exécution. Un retry avec le même `requestId` retourne le snapshot existant du Core sans ré-exécution.

### 10.3 RuleResolver & RuleStore

```ts
// Interface dans @run-iq/dg — pour l'exécution
interface RuleResolver {
  resolve(node: DGNode, meta: ExecutionMeta): Promise<Rule[]>
  fingerprint(node: DGNode, meta: ExecutionMeta): string
}

// Interface dans @run-iq/context-engine — pour la persistance
// interface RuleStore { resolveRules(query: RuleQuery): Promise<SerializedRule[]>; ... }

// En production, on peut bridger les deux :
class RuleStoreResolver implements RuleResolver {
  constructor(private store: RuleStore) {}   // RuleStore de @run-iq/context-engine

  async resolve(node: DGNode, meta: ExecutionMeta): Promise<Rule[]> {
    const serialized = await this.store.resolveRules({
      model:         node.model,
      tenantId:      meta.tenantId,
      effectiveDate: meta.effectiveDate,
      country:       meta.context?.country as string
    })
    return serialized.map(r => JSON.parse(r.payload) as Rule)
  }

  fingerprint(node: DGNode, meta: ExecutionMeta): string {
    return this.store.fingerprint({
      model:         node.model,
      tenantId:      meta.tenantId,
      effectiveDate: meta.effectiveDate,
      country:       meta.context?.country as string
    })
  }
}
```

### 10.4 Implémentations RuleResolver

#### StaticRuleResolver — dev/tests

```ts
class StaticRuleResolver implements RuleResolver {
  constructor(private readonly rules: Rule[]) {}
  async resolve(): Promise<Rule[]> { return this.rules }
  fingerprint(node, meta): string {
    return sha256(JSON.stringify({ nodeId: node.id, rules: this.rules.map(r => r.id) }))
  }
}
```

#### CachedRuleResolver — LRU + TTL

```ts
class CachedRuleResolver implements RuleResolver {
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

#### RetryRuleResolver, TimeoutRuleResolver, CompositeRuleResolver

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

class TimeoutRuleResolver implements RuleResolver {
  constructor(private inner: RuleResolver, private timeoutMs: number) {}
  async resolve(node, meta): Promise<Rule[]> {
    return withTimeout(this.inner.resolve(node, meta), this.timeoutMs, `RuleResolver timeout for "${node.id}"`)
  }
}

class CompositeRuleResolver implements RuleResolver {
  constructor(private resolvers: RuleResolver[]) {}
  async resolve(node, meta): Promise<Rule[]> {
    return (await Promise.all(this.resolvers.map(r => r.resolve(node, meta)))).flat()
  }
}
```

#### Composition recommandée en production

```ts
const resolver = new CachedRuleResolver(
  new TimeoutRuleResolver(
    new RetryRuleResolver(
      new RuleStoreResolver(postgresRuleStore),   // RuleStore de @run-iq/context-engine
      { attempts: 3, backoffMs: 100 }
    ),
    5_000
  ),
  { maxEntries: 1000, ttlMs: 300_000 }
)
```

**Limite de composition** : la profondeur recommandée est de **4 couches maximum** (Cached → Timeout → Retry → Store). Au-delà, le debugging devient impraticable — chaque couche ajoute un niveau de stack trace et un point de failure potentiel.

Pour des besoins avancés (multi-source, fallback entre stores), utiliser `CompositeRuleResolver` au même niveau plutôt que d'empiler des décorateurs :

```ts
// ✅ Correct — composition horizontale
const resolver = new CachedRuleResolver(
  new TimeoutRuleResolver(
    new CompositeRuleResolver([
      new RetryRuleResolver(primaryStore, { attempts: 3, backoffMs: 100 }),
      new RetryRuleResolver(fallbackStore, { attempts: 2, backoffMs: 200 })
    ]),
    5_000
  ),
  { maxEntries: 1000, ttlMs: 300_000 }
)

// ❌ Interdit — empilage vertical excessif
const resolver = new CachedRuleResolver(
  new TimeoutRuleResolver(
    new RetryRuleResolver(
      new CachedRuleResolver(        // doublon de cache = bug probable
        new TimeoutRuleResolver(...), // doublon de timeout = masque les erreurs
        ...
      ), ...
    ), ...
  ), ...
)
```

---

## 11. Couche 6 — DGInspector & Replay

Stateless et pur — prend des données, retourne une analyse. Aucun couplage avec DGOrchestrator ou DGContext.

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

### Replay — rejoue les events, jamais le Core

```ts
replayUntil(events, until): ReplaySnapshot {
  const state    = new Map<string, unknown>()
  const executed: string[] = []
  const skipped:  string[] = []
  let count = 0

  for (const event of events) {
    if (this.reachedUntil(event, until)) break
    count++

    if (event.type === 'node.completed') {
      for (const [portName, value] of Object.entries(event.outputs)) {
        state.set(`${event.nodeId}.${portName}`, value)
      }
      executed.push(event.nodeId)
    }
    if (event.type === 'node.fallback') {
      for (const [portName, value] of Object.entries(event.fallback)) {
        state.set(`${event.nodeId}.${portName}`, value)
      }
    }
    if (event.type === 'node.skipped') skipped.push(event.nodeId)
  }

  return { replayedUntil: until, stateAtPoint: Object.fromEntries(state), executed, skipped, eventsReplayed: count }
}
```

Le replay reconstruit l'état à partir du log d'events — exactement comme `EvaluationContext` mais en lecture seule depuis les events persistés.

### CLI

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

## 12. Matrice des effets combinés

| `onError` parent | `onFailProp.` | `merge.strategy` | `merge.onPartialInputs` | Résultat | Détection |
|---|---|---|---|---|---|
| `fail` | `halt` | — | — | ⛔ Graphe stoppé | runtime |
| `fail` | `skip-descendants` | `wait-all` | `fail` | ⚠️ Merge échoue | runtime |
| `fail` | `skip-descendants` | `wait-all` | `proceed-with-available` | ⚠️ Merge tente sans ce parent | runtime |
| `fail` | `skip-descendants` | `wait-all` | `use-defaults` | ⚠️ Merge utilise defaults | runtime |
| `fail` | `continue` | `wait-all` | `proceed-with-available` | ✅ Merge continue | runtime |
| `fail` | `continue` | `wait-all` | `use-defaults` | ✅ Merge utilise defaults | runtime |
| `fail` | `continue` | `wait-any` | any | ✅ Merge si autre parent | runtime |
| `skip` | `continue` | `wait-all` | any | 🚫 **DEADLOCK** | **compile** |
| `skip` | `skip-descendants` | `wait-all` | any | 🚫 **DEADLOCK** | **compile** |
| `skip` | `continue` | `wait-any` | any | ✅ Merge si autre parent | runtime |
| `skip` | `continue` | `wait-quorum` | any | ✅ si quorum sans ce parent | runtime |
| `skip` | `continue` | `wait-quorum` | `fail` | ⚠️ Échoue si quorum non atteint | runtime |
| `fallback` | `continue` | `wait-all` | any | ✅ Fallback injecté, merge attend | runtime |
| `fallback` | `continue` | `wait-any` | any | ✅ Fallback injecté, merge immédiat | runtime |

---

## 13. Idempotence & déterminisme

### Idempotence des nœuds

**Solution** : `nodeExecutionId = ${meta.requestId}:${node.id}`

Le Core PPE est idempotent sur `requestId` : un `requestId` déjà traité retourne le snapshot existant. Le DG hérite de cette garantie. Deux calls avec le même `meta.requestId` et le même `node.id` → même résultat, zéro double exécution.

### Déterminisme de l'exécution

| Composant | Garantie |
|---|---|
| `ExecutionMeta.timestamp` | Fixé à la création du contexte dans `EvaluationContext`, jamais muté |
| `RuleResolver.fingerprint` | Même inputs → même fingerprint → même règles |
| `CompiledGraph.hash` | `sha256()` de `@run-iq/context-engine/utils` — identifie exactement la version |
| `EvaluationContext` append-only | Aucun écrasement de données possible |
| `parallelWithLimit` | Ordre déterministe dans les limites du semaphore |

Deux exécutions du même graphe (`graphHash` identique) avec les mêmes `input` et `meta.timestamp` produisent un `DGResult.outputs` identique.

### Déterminisme : outputs vs events

**Invariant déterministe** : pour un même `CompiledGraph`, un même `input` et un même `ExecutionMeta`, le DG produit toujours les mêmes **outputs** (état final du contexte) et le même **status**.

**Ce qui N'EST PAS déterministe** :
- Les timestamps des events (`ts` fields) — dépendent de l'horloge système
- L'ordre de complétion des nœuds parallèles — dépend du scheduling OS
- Les `durationMs` — dépendent de la charge système

**Conséquence pratique** : pour comparer deux exécutions, comparer `DGResult.outputs` et `DGResult.status`, jamais `DGResult.events` directement. L'audit trail (events) est un log d'observation, pas un artefact déterministe.

**Pour les tests** : utiliser `expect(result.outputs).toEqual(expected)` et `expect(result.status).toBe('completed')`. Ne jamais asserter sur l'ordre des events ou les timestamps.

---

## 14. Intégration avec l'écosystème Run-IQ

### 14.1 @run-iq/server

```
POST /graph/compile          → DGCompiler.compile(graph) → sauvegarde via GraphStore
POST /graph/execute          → DGOrchestrator.execute(compiled, input, meta)
POST /graph/run              → compile + execute (one-shot)
GET  /graph/:hash            → GraphStore.getCompiledGraph(hash)
POST /graph/:hash/execute    → exécution pré-compilée (le plus rapide)
GET  /execution/:id/state    → ExecutionStore.getExecution(id) → state reconstruit
```

### 14.2 Initialisation complète

```ts
import { createInMemoryAdapter } from '@run-iq/context-engine/adapters'

// Développement
const adapter = createInMemoryAdapter()

// Production
const adapter: PersistenceAdapter = {
  graphs:     new PostgresGraphStore(pgClient),
  rules:      new PostgresRuleStore(pgClient),
  executions: new PostgresExecutionStore(pgClient)
}

// Engine
const engine = new PPEEngine({ plugins: [fiscalPlugin, payrollPlugin], dsls: [jsonlogicDSL] })

// Resolver (utilise RuleStore de context-engine)
const resolver = new CachedRuleResolver(
  new TimeoutRuleResolver(
    new RetryRuleResolver(
      new RuleStoreResolver(adapter.rules!),
      { attempts: 3, backoffMs: 100 }
    ),
    5_000
  ),
  { maxEntries: 1000, ttlMs: 300_000 }
)

// Orchestrateur — inject adapter
const orchestrator = new DGOrchestrator(
  new CoreNodeExecutor(engine, resolver),
  engine.getDSLRegistry(),
  {
    logLevel: 'standard',
    limits:   { maxNodes: 500, maxDepth: 50, maxEvents: 10_000, maxDurationMs: 30_000, maxParallelNodes: 20 },
    adapter,  // PersistenceAdapter de @run-iq/context-engine
    hooks: {
      afterGraph: async (result) => {
        await telemetry.record('dg.execution', { durationMs: result.durationMs, status: result.status })
      }
    }
  }
)
```

### 14.3 DSLEvaluator — zéro duplication

```ts
// Défini dans @run-iq/core
interface DSLEvaluator {
  readonly dsl:     string
  readonly version: string
  evaluate(expression: unknown, context: Record<string, unknown>): boolean
  describeSyntax?(): DSLSyntaxDoc
}

// Dans @run-iq/dg — consommé via injection depuis le Core
const dslRegistry = engine.getDSLRegistry()   // Map<string, DSLEvaluator>
const orchestrator = new DGOrchestrator(executor, dslRegistry, options)
```

### 14.4 Plugin fiscal — interaction transparente

Le DG appelle `engine.evaluate()`. Le plugin fiscal exécute son `beforeEvaluate` hook en interne (META_INHIBITION, META_SUBSTITUTION, jurisdiction resolution). Le DG ne voit jamais ces mécanismes.

Avec `storeRaw: true`, le `fiscalBreakdown` est accessible via `EvaluationContext.get()` :

```
ctx.get('tax_calc.__raw.fiscalBreakdown.TVA')   → 300000
```

---

## 15. Structure du package

```
packages/dg/
├── src/
│   ├── types/
│   │   ├── graph.ts            → DGGraph, DGNode, DGEdge, DGNodeType, GraphMeta
│   │   ├── ports.ts            → PortDescriptor, PortWiring, EdgeEndpoint
│   │   ├── policy.ts           → NodePolicy, MergeNodeConfig, ExecutionLimits
│   │   ├── events.ts           → DGEvent, SkipReason, DGStatus, LogLevel
│   │   ├── result.ts           → DGResult, DGLevelSnapshot
│   │   ├── compiled.ts         → CompiledGraph, ExecutionLevel,
│   │   │                          FailurePropagationMap, DSLVariableMap
│   │   └── index.ts
│   │
│   ├── compiler/
│   │   ├── DGCompiler.ts
│   │   ├── steps/
│   │   │   ├── step0-identifiers.ts    → utilise la même regex que context-engine
│   │   │   ├── step1-structure.ts
│   │   │   ├── step2-cycles.ts         → algorithme de Kahn
│   │   │   ├── step3-toposort.ts       → niveaux + mergeNodes séparés
│   │   │   ├── step4-wiring.ts         → WiringMap précalculée
│   │   │   ├── step5-failures.ts       → FailurePropagationMap DFS
│   │   │   ├── step6-policies.ts       → deadlock detection
│   │   │   ├── step7-hash.ts           → sha256 de @run-iq/context-engine/utils
│   │   │   └── step8-dsl-vars.ts       → analyse statique variables DSL
│   │   └── errors.ts                   → DGCompileError, CompileWarning
│   │
│   ├── context/
│   │   ├── DGContext.ts        → extends EvaluationContext (@run-iq/context-engine)
│   │   │                          + DGEvent log + streaming + buildResult()
│   │   └── logLevels.ts        → shouldLog() par LogLevel
│   │
│   ├── orchestrator/
│   │   ├── DGOrchestrator.ts       → boucle principale + persistence adapter
│   │   ├── nodeRunner.ts           → runNode(), injectOutputs(), extractInputs()
│   │   ├── mergeRunner.ts          → runMerge(), quorum logic
│   │   ├── edgeResolver.ts         → resolveActiveNodes(), condition evaluation
│   │   ├── parallelWithLimit.ts    → semaphore
│   │   └── hooks.ts                → DGLifecycleHooks
│   │
│   ├── executor/
│   │   ├── NodeExecutor.ts         → interface + NodeResult
│   │   └── CoreNodeExecutor.ts     → idempotence via nodeExecutionId
│   │
│   ├── resolver/
│   │   ├── RuleResolver.ts             → interface
│   │   ├── RuleStoreResolver.ts        → bridge RuleResolver → RuleStore (context-engine)
│   │   ├── StaticRuleResolver.ts
│   │   ├── CachedRuleResolver.ts       → LRU + TTL
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
│   ├── errors.ts     → DGError, DGCycleError, DGHaltError, DGMergeError,
│   │                    DGLimitError, DGOutputSizeError, DGTimeoutError,
│   │                    DGMissingInputError
│   │                    (NB: ContextConflictError, ContextLimitError viennent
│   │                    de @run-iq/context-engine — pas redéfinis ici)
│   ├── utils.ts      → now(), sleep(), withTimeout()
│   │                    (roughSizeKb, sha256 : importés de @run-iq/context-engine/utils)
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
│   │   │   ├── DGContext-extends.test.ts   ← vérifie l'héritage EvaluationContext
│   │   │   ├── event-log.test.ts
│   │   │   ├── log-levels.test.ts
│   │   │   ├── streaming.test.ts
│   │   │   └── persistence.test.ts         ← adapter.executions.recordEvent appelé
│   │   ├── orchestrator/
│   │   │   ├── parallel-limit.test.ts
│   │   │   ├── edge-conditions.test.ts
│   │   │   ├── failure-propagation.test.ts
│   │   │   └── extract-inject.test.ts
│   │   ├── resolver/
│   │   │   ├── rule-store-resolver.test.ts ← bridge context-engine
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
│       ├── policy-matrix.test.ts
│       ├── idempotence.test.ts
│       ├── limits.test.ts
│       ├── persistence.test.ts           ← intégration complète avec InMemoryAdapter
│       └── replay.test.ts
│
├── package.json
│   {
│     "name": "@run-iq/dg",
│     "dependencies": {
│       "@run-iq/context-engine": "workspace:*",
│       "@run-iq/core": "workspace:*"
│     }
│   }
│
└── tsconfig.json
```

---

## 16. Cas d'usage concrets

### 16.1 Calcul fiscal multi-modèles (Togo, régime réel)

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
          { "name": "irppDue", "required": true },
          { "name": "tvaDue",  "required": true },
          { "name": "imfDue",  "required": true }
        ],
        "out": [{ "name": "totalTax", "required": true }]
      },
      "policy": { "onError": "fail", "onFailPropagation": "halt" },
      "meta": { "mergeConfig": { "strategy": "wait-all", "onPartialInputs": "use-defaults" } }
    }
  },
  "edges": [
    { "id": "e1", "from": { "node": "irpp", "port": "irppDue" }, "to": { "node": "report", "port": "irppDue" } },
    { "id": "e2", "from": { "node": "tva",  "port": "tvaDue"  }, "to": { "node": "report", "port": "tvaDue"  } },
    { "id": "e3", "from": { "node": "imf",  "port": "imfDue"  }, "to": { "node": "report", "port": "imfDue"  } }
  ]
}
```

State du contexte après exécution complète :
```json
{
  "input.income":   6000000,
  "input.revenue":  30000000,
  "irpp.irppDue":   1200000,
  "tva.tvaDue":     4500000,
  "imf.imfDue":     500000,
  "report.totalTax": 6200000
}
```

### 16.2 Skip conditionnel (paie si ≥ 3 employés)

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

Si `input.employeeCount < 3` → `ctx.getFullState()` passé au DSL → condition `false` → `edge.inactive` émis → nœud `payroll` skippé.

---

## 17. Roadmap d'implémentation

### Phase 0 — Prérequis : implémenter @run-iq/context-engine

**Avant de toucher à @run-iq/dg**, implémenter complètement `@run-iq/context-engine` :

- [ ] `EvaluationContext` : append-only, namespace, get/set/setRaw, snapshots, limits, hooks
- [ ] `PersistenceAdapter` interface
- [ ] `GraphStore`, `RuleStore`, `ExecutionStore` interfaces + types
- [ ] `InMemoryGraphStore`, `InMemoryRuleStore`, `InMemoryExecutionStore`
- [ ] `createInMemoryAdapter()`
- [ ] Erreurs, utilitaires (`roughSizeKb`, `sha256`, `getNestedValue`)
- [ ] Tests unitaires et d'intégration complets

### Phase 1 — MVP DG (semaine 1-2 après context-engine)

- [ ] Types DG (graph, ports, policy, events, result)
- [ ] `DGCompiler` étapes 0–5
- [ ] `DGContext extends EvaluationContext` : event log, logLevel, buildResult
- [ ] `DGOrchestrator` : boucle principale + parallelWithLimit
- [ ] `CoreNodeExecutor` : idempotence via `nodeExecutionId`
- [ ] `StaticRuleResolver`
- [ ] Tests unitaires compiler 0–5, DGContext héritage, idempotence

### Phase 2 — Robustesse (semaine 3-4)

- [ ] `DGCompiler` étapes 6–8 (policies, hash, DSL vars)
- [ ] `NodePolicy` complet : fallback, skip, halt, propagation, `maxOutputSizeKb`
- [ ] `MergeRunner` : wait-all, wait-any, wait-quorum + onPartialInputs
- [ ] Edge conditions source-output + full-context
- [ ] `CachedRuleResolver`, `RetryRuleResolver`, `TimeoutRuleResolver`
- [ ] `ExecutionLimits` runtime enforcement
- [ ] Tests intégration : policy matrix, merge strategies, failure propagation

### Phase 3 — Production (semaine 5-6)

- [ ] `RuleStoreResolver` : bridge RuleResolver → RuleStore de context-engine
- [ ] `CompositeRuleResolver`
- [ ] Context streaming (EventEmitter + fire-and-forget persistence)
- [ ] `DGLifecycleHooks`
- [ ] `DGInspector` complet : explainNode, criticalPath, replayUntil, verify, toMermaid
- [ ] Intégration `@run-iq/server` : endpoints + cache via GraphStore
- [ ] Tests persistence avec InMemoryAdapter (intégration complète context-engine ↔ dg)

### Phase 4 — Intelligence (semaine 7-8)

- [ ] `MCPRuleResolver`
- [ ] Outils MCP : compile_graph, execute_graph, inspect_graph_result, visualize_graph
- [ ] CLI : dg compile, dg run, dg inspect, dg trace, dg critical, dg replay, dg verify, dg viz
- [ ] Playground web (nœuds colorés par statut via streaming)

---

## 18. Contrats de test

### Compiler — unitaires

```ts
// Étape 0 — identifiants (cohérence avec context-engine)
✓ rejette nodeId 'tax.calc' (même règle que EvaluationContext.validateIdentifier)
✓ rejette portName avec espace
✓ rejette edgeId avec caractère spécial
✓ accepte [a-zA-Z0-9_-]

// Étapes 1–5 (déjà couverts dans v2.0)
✓ rejette edge référençant nodeId inexistant
✓ rejette cycle direct et indirect
✓ produit niveaux topologiques corrects
✓ sépare mergeNodes dans ExecutionLevel
✓ FailurePropagationMap liste tous les descendants transitifs

// Étape 6 — deadlocks
✓ rejette skip + wait-all (deadlock garanti)
✓ warning > 3 nœuds storeRaw

// Étape 7 — hash
✓ sha256 est importé de @run-iq/context-engine/utils (pas de dépendance crypto séparée)
✓ même graphe → même hash
✓ graphe modifié → hash différent

// Étape 8 — DSL vars
✓ erreur variable même niveau (race condition)
✓ warning variable non trouvée
✓ accepte variables niveaux inférieurs
```

### DGContext — unitaires

```ts
// Héritage EvaluationContext
✓ ctx.set() utilise EvaluationContext.set() — namespace enforced
✓ ctx.set() throw ContextConflictError (de @run-iq/context-engine) si doublon
✓ ctx.get() utilise EvaluationContext.get() — résolution en cascade
✓ ctx.setRaw() utilise EvaluationContext.setRaw()
✓ ctx.getNodeOutputs() héritée et fonctionnelle
✓ ctx.getFullState() héritée — utilisée pour edge conditions full-context
✓ ctx.snapshot() héritée — retourne ContextSnapshot de @run-iq/context-engine

// Spécifique DGContext
✓ emit() ajoute l'event au log
✓ emit() throw DGLimitError si maxEvents dépassé
✓ emit() stream l'event via EventEmitter si présent
✓ emit() appelle adapter.executions.recordEvent() si adapter présent (fire-and-forget)
✓ isSkipped() retourne true après node.skipped event
✓ isFailed() retourne true après node.failed event
✓ isEdgeInactive() retourne true après edge.inactive event
✓ logLevel minimal — 3 types d'events seulement
✓ logLevel verbose — tous les events
✓ buildResult() construit DGResult depuis eventLog + EvaluationContext.getFullState()
✓ levelSnapshot() appelle EvaluationContext.snapshot() + filtre les events

// Persistence (adapter)
✓ si adapter absent → pas d'erreur (comportement in-memory pur)
✓ si adapter présent → adapter.executions.recordEvent appelé pour chaque event émis
✓ erreur de persistence dans recordEvent → log uniquement, jamais fatal
```

### Orchestrateur — unitaires

```ts
// Persistence adapter
✓ startExecution appelé au début si adapter.executions présent
✓ completeExecution appelé à la fin si adapter.executions présent
✓ si adapter absent → exécution identique (pas de régression)

// Injection / extraction (via EvaluationContext)
✓ injectOutputs utilise ctx.set() — ContextConflictError propagée si doublon
✓ extractInputs utilise ctx.get() — résolution en cascade pour __raw subpaths
✓ extractInputs utilise port.default si valeur absente et port non-required
✓ extractInputs throw DGMissingInputError si port required absent

// Edge conditions
✓ scope: source-output → ctx.getNodeOutputs() passé au DSL
✓ scope: full-context  → ctx.getFullState() passé au DSL
✓ edge inactive → ctx.emit edge.inactive + nœud skippé

// Failure propagation
✓ halt → DGHaltError propagée
✓ skip-descendants → descendants skippés via FailurePropagationMap O(1)
✓ continue → descendants s'exécutent avec defaults
✓ fallback → ctx.set() pour chaque port, ctx.markCompleted()

// Parallélisme + limites
✓ maxParallelNodes respecté
✓ DGLimitError si maxDurationMs dépassé
✓ merge nodes exécutés après nodes normaux du même niveau
```

### Idempotence — intégration

```ts
✓ même requestId + même input → même DGResult
✓ nodeExecutionId = graphRequestId:nodeId
✓ retry graphe avec même requestId → pas de double exécution Core
```

### Persistence — intégration avec context-engine

```ts
// Tests avec createInMemoryAdapter()
✓ après exécution : ExecutionStore.getExecution(requestId) retourne la StoredExecution
✓ StoredExecution.events contient tous les DGEvents dans l'ordre (sequence croissant)
✓ StoredExecution.record.status = 'completed' après succès
✓ StoredExecution.record.status = 'failed' après DGHaltError
✓ GraphStore.getCompiledGraph(hash) retourne le graphe compilé après saveCompiledGraph
✓ RuleStoreResolver résout les règles via InMemoryRuleStore
```

### Policy matrix — intégration

```ts
// Chaque ligne de la matrice §12
✓ fail + halt → graphe stoppé, ExecutionStore.status = 'failed'
✓ skip + wait-all → DEADLOCK rejeté au compile-time
✓ fallback + wait-all → fallback injecté dans EvaluationContext, merge attend
// ... toutes les combinaisons valides
```

---

*Ce document est la source de vérité pour l'implémentation de `@run-iq/dg`.*  
*`@run-iq/context-engine` doit être implémenté et testé avant de commencer ce package.*  
*Toute déviation doit être discutée et documentée ici avant d'être codée.*