import { describe, it, expect } from 'vitest';
import pkg from '../../package.json' with { type: 'json' };
import { SUPPORTED_PEERS, VERSION } from '../../src/index.js';

describe('version', () => {
  it('VERSION is the package version', () => {
    expect(VERSION).toBe(pkg.version);
  });

  it('SUPPORTED_PEERS lists the peer ranges', () => {
    expect(SUPPORTED_PEERS).toEqual(pkg.peerDependencies);
  });
});
