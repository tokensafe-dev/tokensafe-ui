/**
 * Solid-free entry point for static discovery.
 *
 * `@tokensafe-ui/oumv`'s index evaluates the native SolidJS runtime; a React/Vue
 * dev-server must be able to scan source files without pulling that runtime in.
 * Everything here is pure Babel/fs work.
 */
export {
  scanProjectStaticResources,
  scanSourceForComponents,
  type StaticDiscoveredComponent,
  type StaticDiscoveredRoute,
  type StaticDiscoveryResult,
} from './static_discovery.js';
