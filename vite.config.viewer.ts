import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'
import path from 'path'

const editorOrigin = process.env.VITE_EDITOR_ORIGIN || 'https://doeringc.ch/slides'

const PAYLOAD_SENTINEL = '<!--SLIDES_PAYLOAD-->'

function injectPayloadSentinel() {
  return {
    name: 'inject-payload-sentinel',
    transformIndexHtml(html: string) {
      return html.replace('</body>', `  ${PAYLOAD_SENTINEL}\n  </body>`)
    },
  }
}

// Single-file viewer build. Entry is viewer.html → src/viewer-main.tsx → ViewerApp,
// which mounts PresenterView. The editor UI (AppLayout, Toolbar, ProjectPicker,
// vaultStore, export utilities) is never imported, so tree-shaking drops it.
export default defineConfig({
  base: './',
  define: {
    __SLIDES_STANDALONE_BUILD__: 'true',
    __SLIDES_EDITOR_ORIGIN__: JSON.stringify(editorOrigin),
  },
  plugins: [react(), injectPayloadSentinel(), viteSingleFile()],
  build: {
    outDir: 'dist-standalone-viewer',
    emptyOutDir: true,
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    rollupOptions: {
      input: path.resolve(__dirname, 'viewer.html'),
      output: {
        inlineDynamicImports: true,
      },
    },
  },
})
