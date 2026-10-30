// Named imports: the bundler inlines only these fields, not the whole package.json.
import { version, peerDependencies } from '../package.json';
import { VERSION as CORE_VERSION } from '@run-iq/core';
import { VERSION as CONTEXT_ENGINE_VERSION } from '@run-iq/context-engine';

/** This package's version, read from package.json at build time. */
export const VERSION: string = version;

/** The peer version ranges this package supports, from its package.json. */
export const SUPPORTED_PEERS: Readonly<Record<string, string>> = Object.freeze({
  ...peerDependencies,
});

/** The dg, core and context-engine versions loaded in this process. */
export function loadedVersions(): { dg: string; core: string; contextEngine: string } {
  return { dg: VERSION, core: CORE_VERSION, contextEngine: CONTEXT_ENGINE_VERSION };
}
