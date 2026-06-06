import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { spawn, ChildProcess } from 'child_process'
import path from 'path'
import fs from 'fs'

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
    configureServer(server: any) {
      for (const [route, { file, buildCmd }] of Object.entries(routes)) {
        server.middlewares.use(route, (_req: any, res: any) => {
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
    configureServer() {
      const serverDir = path.resolve(__dirname, 'server');

      console.log('\x1b[36m%s\x1b[0m', '🚀 Starting backend server...');

      // Spawn the server via tsx so it can import TypeScript files (e.g. the
      // shared collab schema in src/). tsx is hoisted to the workspace root.
      const tsxBin = path.resolve(__dirname, 'node_modules', '.bin', 'tsx');
      serverProcess = spawn(tsxBin, ['index.js'], {
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

      // Clean up on exit
      process.on('exit', () => {
        serverProcess?.kill();
      });
      process.on('SIGINT', () => {
        serverProcess?.kill();
        process.exit();
      });
      process.on('SIGTERM', () => {
        serverProcess?.kill();
        process.exit();
      });
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
      globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2,ttf}'],
      maximumFileSizeToCacheInBytes: 5_000_000,
      navigateFallback: '/slides/index.html',
      // Don't precache the prebuilt standalone-template / viewer-template HTMLs
      // — they're fetched on demand by the exporter (Workbox's runtime cache
      // can handle them) and would otherwise inflate the precache by ~7.5 MB.
      globIgnores: ['standalone-template.html', 'viewer-template.html'],
    },
    devOptions: {
      // Disable in dev to avoid SW caching getting in the way of HMR.
      enabled: false,
    },
  })
}

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  // Base path for GitHub Pages - use repo name as base
  // Change 'slides' to your actual repository name if different
  base: command === 'build' ? '/slides/' : '/',
  define: {
    __SLIDES_STANDALONE_BUILD__: 'false',
    __SLIDES_EDITOR_ORIGIN__: JSON.stringify(process.env.VITE_EDITOR_ORIGIN || 'https://doeringc.ch/slides'),
  },
  plugins: command === 'serve'
    ? [react(), backendServer(), standaloneTemplateMiddleware()]
    : [react(), editorPwa()],
}))
