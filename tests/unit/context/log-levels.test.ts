import { describe, it, expect } from 'vitest';
import { shouldLog } from '../../../src/context/logLevels.js';
import type { DGEvent } from '../../../src/types/events.js';

const ALL_EVENT_TYPES: DGEvent['type'][] = [
  'graph.started',
  'level.started',
  'node.started',
  'node.completed',
  'node.raw_stored',
  'node.skipped',
  'node.failed',
  'node.fallback',
  'edge.inactive',
  'merge.waiting',
  'level.completed',
  'graph.completed',
];

describe('logLevels', () => {
  describe('minimal', () => {
    it('allows graph.started', () => {
      expect(shouldLog('graph.started', 'minimal')).toBe(true);
    });

    it('allows node.failed', () => {
      expect(shouldLog('node.failed', 'minimal')).toBe(true);
    });

    it('allows graph.completed', () => {
      expect(shouldLog('graph.completed', 'minimal')).toBe(true);
    });

    it('rejects node.started', () => {
      expect(shouldLog('node.started', 'minimal')).toBe(false);
    });

    it('rejects node.completed', () => {
      expect(shouldLog('node.completed', 'minimal')).toBe(false);
    });

    it('rejects level.started', () => {
      expect(shouldLog('level.started', 'minimal')).toBe(false);
    });
  });

  describe('standard', () => {
    it('allows node.started', () => {
      expect(shouldLog('node.started', 'standard')).toBe(true);
    });

    it('allows node.completed', () => {
      expect(shouldLog('node.completed', 'standard')).toBe(true);
    });

    it('rejects edge.inactive', () => {
      expect(shouldLog('edge.inactive', 'standard')).toBe(false);
    });

    it('rejects merge.waiting', () => {
      expect(shouldLog('merge.waiting', 'standard')).toBe(false);
    });

    it('rejects node.raw_stored', () => {
      expect(shouldLog('node.raw_stored', 'standard')).toBe(false);
    });
  });

  describe('verbose', () => {
    it('allows all event types', () => {
      for (const eventType of ALL_EVENT_TYPES) {
        expect(shouldLog(eventType, 'verbose')).toBe(true);
      }
    });
  });
});
