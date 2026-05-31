import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

const editorOrigin = process.env.VITE_EDITOR_ORIGIN || 'https://doeringc.ch/slides'

// Sentinel that exportStandaloneHtml.ts replaces with the payload/config scripts.
const PAYLOAD_SENTINEL = '<!--SLIDES_PAYLOAD-->'

// Inject the payload sentinel just before </body>, plus a build-time constant
// telling the bundle the default editor origin (used by the viewer's link-back).
function injectPayloadSentinel() {
  return {
    name: 'inject-payload-sentinel',
    transformIndexHtml(html: string) {
      return html.replace('</body>', `  ${PAYLOAD_SENTINEL}\n  </body>`)
    },
  }
}

export default defineConfig({
  base: './',
  define: {
    __SLIDES_STANDALONE_BUILD__: 'true',
    __SLIDES_EDITOR_ORIGIN__: JSON.stringify(editorOrigin),
  },
  plugins: [react(), injectPayloadSentinel(), viteSingleFile()],
  build: {
    outDir: 'dist-standalone',
    emptyOutDir: true,
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
})
