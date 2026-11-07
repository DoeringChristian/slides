import { defineConfig, type ViteDevServer } from 'vite'
import { configDefaults } from 'vitest/config'
import type { IncomingMessage, ServerResponse } from 'http'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { spawn, ChildProcess } from 'child_process'
import path from 'path'
import fs from 'fs'
import pkg from './package.json'

// MathJax 4 must never be dependency-pre-bundled.
//
// A font package's `svg.js` exports the font class, and its ~40 lazily loaded
// glyph ranges (`svg/dynamic/*.js`) register their characters onto that class
// through a RELATIVE import of it. Pre-bundling rewrites the bare specifier
// our font registry uses into `.vite/deps/…` while the range modules keep
// resolving `../../svg.js` to the real file — two copies of the same class.
// The ranges then decorate the copy nobody renders with, MathJax reports
// "dynamic file 'double-struck' failed to load", and every expression using
// \mathbb, \mathfrak, \boldsymbol or a large delimiter silently falls back
// to its own source text.
//
// Rollup resolves both forms to one module id, so production was never
// affected and neither was vitest — this is a dev-server-only split, which is
// precisely the configuration being edited in. Derived from the dependency
// list so adding a math font cannot forget it.
const MATHJAX_PACKAGES = Object.keys(pkg.dependencies).filter((name) => name.startsWith('@mathjax/'))

// Vite middleware: serve the prebuilt standalone/viewer templates during dev so the
// editor's exporter can fetch them. Falls back to a friendly 404 if the templates
// haven't been built yet.
function standaloneTemplateMiddleware() {
  const routes: Record<string, { file: string; buildCmd: string }> = {
    '/standalone-template.html': { file: 'dist-standalone/index.html', buildCmd: 'npm run build:standalone' },
    '/viewer-template.html': { file: 'dist-standalone-viewer/viewer.html', buildCmd: 'npm run build:viewer' },
  }
  return {
    name: 'standalone-template-middleware',
    configureServer(server: ViteDevServer) {
      for (const [route, { file, buildCmd }] of Object.entries(routes)) {
        server.middlewares.use(route, (_req: IncomingMessage, res: ServerResponse) => {
          const fullPath = path.resolve(__dirname, file)
          if (!fs.existsSync(fullPath)) {
            res.statusCode = 404
            res.end(`Run \`${buildCmd}\` once to generate the template.`)
            return
          }
          res.setHeader('Content-Type', 'text/html')
          fs.createReadStream(fullPath).pipe(res)
        })
      }
    },
  }
}

// Plugin to start the backend server during development
function backendServer() {
  let serverProcess: ChildProcess | null = null;

  return {
    name: 'backend-server',
    async configureServer(server: ViteDevServer) {
      // Another dev session may already own the backend. Reuse it without
      // claiming ownership (closing this Vite session must not kill it).
      try {
        const response = await fetch('http://localhost:3001/api/health', {
          signal: AbortSignal.timeout(1500),
        });
        const health = await response.json();
        if (response.ok && health && typeof health === 'object' &&
            'status' in health && health.status === 'ok' &&
            'timestamp' in health && typeof health.timestamp === 'number') {
          console.log('Using existing Slides backend on http://localhost:3001');
          return;
        }
        throw new Error('Port 3001 is occupied by an unexpected service');
      } catch (error) {
        // Only a refused connection means it is safe to start a backend.
        const cause = (error as { cause?: { code?: string; errors?: { code?: string }[] } }).cause;
        const refused = cause?.code === 'ECONNREFUSED' ||
          (cause?.errors?.length && cause.errors.every(e => e.code === 'ECONNREFUSED'));
        if (!refused) throw error;
      }
      const serverDir = path.resolve(__dirname, 'server');

      console.log('\x1b[36m%s\x1b[0m', '🚀 Starting backend server...');

      // Run Node directly with the tsx loader, so the owned child is the
      // backend itself rather than a CLI wrapper that can leave it orphaned.
      serverProcess = spawn(process.execPath, ['--import', 'tsx', 'index.js'], {
        cwd: serverDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PORT: '3001' }
      });

      serverProcess.stdout?.on('data', (data) => {
        console.log('\x1b[35m[server]\x1b[0m', data.toString().trim());
      });

      serverProcess.stderr?.on('data', (data) => {
        console.error('\x1b[31m[server]\x1b[0m', data.toString().trim());
      });

      serverProcess.on('error', (err) => {
        console.error('\x1b[31m[server] Failed to start:\x1b[0m', err.message);
      });

      const cleanup = () => {
        serverProcess?.kill();
        serverProcess = null;
        process.off('exit', cleanup);
        process.off('SIGINT', onInterrupt);
        process.off('SIGTERM', onTerminate);
      };
      const onInterrupt = () => { cleanup(); process.exit(130); };
      const onTerminate = () => { cleanup(); process.exit(143); };
      process.once('exit', cleanup);
      process.once('SIGINT', onInterrupt);
      process.once('SIGTERM', onTerminate);
      // Also covers server.close() and Vite config restarts.
      server.httpServer?.once('close', cleanup);
    }
  };
}

// PWA config for the editor build. Standalone HTML / viewer builds have their
// own configs (vite.config.standalone.ts, vite.config.viewer.ts) and never see
// this plugin — those outputs are single-file HTMLs and must not register a
// service worker (they're opened from file:// by recipients).
function editorPwa() {
  return VitePWA({
    registerType: 'autoUpdate',
    includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png'],
    manifest: {
      name: 'Slides',
      short_name: 'Slides',
      description: 'Presentation editor',
      theme_color: '#3b82f6',
      background_color: '#ffffff',
      display: 'standalone',
      orientation: 'any',
      scope: '/slides/',
      start_url: '/slides/',
      icons: [
        { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
        { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
        { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
        { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    workbox: {
      // Precache app shell + assets. KaTeX fonts (≤ 100 KB each) are included
      // automatically by globPatterns; bumping maximumFileSizeToCacheInBytes
      // accommodates the editor's larger JS chunk.
      globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2,ttf,otf}'],
      maximumFileSizeToCacheInBytes: 5_000_000,
      navigateFallback: '/slides/index.html',
      // Don't precache the prebuilt standalone-template / viewer-template HTMLs
      // — they're fetched on demand by the exporter (Workbox's runtime cache
      // can handle them) and would otherwise inflate the precache by ~7.5 MB.
      // MathJax is lazy by construction — the engine, each of the 11 font
      // packages and each font's ~40 glyph ranges are separate dynamic
      // imports, fetched only by a deck that actually contains math, and only
      // for the font and the characters it uses. Precaching all of it would
      // put ~24 MB through the service worker on first load for every user,
      // including the ones whose decks have no equations at all. Workbox's
      // runtime cache keeps whatever does get fetched.
      globIgnores: ['standalone-template.html', 'viewer-template.html', 'assets/mathjax/**'],
    },
    devOptions: {
      // Disable in dev to avoid SW caching getting in the way of HMR.
      enabled: false,
    },
  })
}

// https://vite.dev/config/
export default defineConfig(({ command }) => {
  // Vitest boots an internal Vite dev server (command === 'serve') to
  // transform test modules, which would run configureServer hooks and spawn
  // the backend — leaving a child process that keeps the test run from
  // exiting. Dev-server-only plugins are for `npm run dev`, not tests.
  const isVitest = !!process.env.VITEST;
  return {
    // Base path for GitHub Pages - use repo name as base
    // Change 'slides' to your actual repository name if different
    base: command === 'build' ? '/slides/' : '/',
    // Agent worktrees under .claude/ and the vendored inkwell prototype carry
    // their own copies of the suites — don't double-run them.
    test: {
      exclude: [...configDefaults.exclude, '**/.claude/**', 'inkwell/**'],
    },
    optimizeDeps: {
      exclude: MATHJAX_PACKAGES,
    },
    build: {
      rollupOptions: {
        output: {
          // Park every MathJax chunk under assets/mathjax/ so the service
          // worker can tell them apart from app code and leave them out of
          // the precache (see globIgnores). Only chunks made ENTIRELY of
          // MathJax modules move; anything mixed with app code stays put.
          chunkFileNames: (chunk) => {
            const ids = chunk.moduleIds ?? []
            const allMathJax = ids.length > 0 && ids.every((id) => id.includes('/@mathjax/'))
            return allMathJax ? 'assets/mathjax/[name]-[hash].js' : 'assets/[name]-[hash].js'
          },
        },
      },
    },
    define: {
      __SLIDES_STANDALONE_BUILD__: 'false',
      __SLIDES_EDITOR_ORIGIN__: JSON.stringify(process.env.VITE_EDITOR_ORIGIN || 'https://doeringc.de/slides'),
    },
    plugins: command === 'serve'
      ? [react(), ...(isVitest ? [] : [backendServer(), standaloneTemplateMiddleware()])]
      : [react(), editorPwa()],
  }
})
