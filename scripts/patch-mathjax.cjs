#!/usr/bin/env node
/**
 * Patches mathjax-full to remove the eval('require') fallback in version.js.
 * MathJax's version.ts checks `typeof PACKAGE_VERSION` — a Webpack DefinePlugin
 * convention that doesn't work with Vite's dep pre-bundling. This script
 * hardcodes the version string so the browser-crashing eval() is never reached.
 *
 * Runs automatically via the "postinstall" script in package.json.
 */
const fs = require('fs');
const path = require('path');

const versionFile = path.join(
  __dirname, '..', 'node_modules', 'mathjax-full', 'js', 'components', 'version.js'
);

if (!fs.existsSync(versionFile)) {
  // mathjax-full not installed — nothing to patch
  process.exit(0);
}

const pkg = require(path.join(
  __dirname, '..', 'node_modules', 'mathjax-full', 'package.json'
));

const patched = [
  '"use strict";',
  'Object.defineProperty(exports, "__esModule", { value: true });',
  'exports.VERSION = void 0;',
  `exports.VERSION = '${pkg.version}';`,
  '//# sourceMappingURL=version.js.map',
  '',
].join('\n');

fs.writeFileSync(versionFile, patched);
console.log(`[patch-mathjax] Patched version.js → '${pkg.version}'`);
