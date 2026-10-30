import pkg from '../package.json' with { type: 'json' };

/** This package's version, read from package.json at build time. */
export const VERSION: string = pkg.version;

/** Lowest version of a peer that this package supports: `^1.0.0-next.0` gives `1.0.0-next.0`. */
function peerFloor(range: string): string {
  return range.replace(/^[\^~]/, '');
}

export const CORE_VERSION: string = peerFloor(pkg.peerDependencies['@run-iq/core']);
export const CONTEXT_ENGINE_VERSION: string = peerFloor(
  pkg.peerDependencies['@run-iq/context-engine'],
);
