import type { DGEvent, LogLevel } from '../types/events.js';

const MINIMAL_EVENTS: ReadonlySet<DGEvent['type']> = new Set([
  'graph.started',
  'node.failed',
  'graph.completed',
]);

const VERBOSE_ONLY_EVENTS: ReadonlySet<DGEvent['type']> = new Set([
  'edge.inactive',
  'merge.waiting',
  'node.raw_stored',
]);

export function shouldLog(eventType: DGEvent['type'], level: LogLevel): boolean {
  if (level === 'verbose') return true;
  if (level === 'minimal') return MINIMAL_EVENTS.has(eventType);
  // standard — everything except verbose-only events
  return !VERBOSE_ONLY_EVENTS.has(eventType);
}
