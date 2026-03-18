export interface NodePorts {
  readonly in: readonly PortDescriptor[];
  readonly out: readonly PortDescriptor[];
}

export interface PortDescriptor {
  readonly name: string;
  readonly required: boolean;
  readonly schema?: unknown;
  readonly default?: unknown;
}

export interface PortWiring {
  readonly fromNode: string;
  readonly fromPort: string;
  readonly toNode: string;
  readonly toPort: string;
  readonly aliasedAs?: string;
}

export type WiringMap = Map<string, readonly PortWiring[]>;
