import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'
import path from 'path'

const editorOrigin = process.env.VITE_EDITOR_ORIGIN || 'https://doeringc.de/slides'

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
//
// Fonts and MathJax cannot be dropped that way, because the player genuinely
// reaches the code that would load them — it just never needs the result. An
// export bakes text: `bakeLayouts` resolves every text element on every slide
// and embeds the glyph outlines, so the player draws paths it was handed
// rather than parsing a font file or running TeX. The two aliases below
// replace the only modules that hold those bytes with same-shaped empties,
// which takes ~30 MB of MathJax glyph tables and ~5 MB of text faces out of
// every exported deck. The EDITABLE standalone export (vite.config.standalone)
// deliberately keeps both: it can be typed into, so it needs live layout.
export default defineConfig({
  base: './',
  resolve: {
    alias: [
      // The regex must match the WHOLE specifier: `find` replaces only the
      // matched part, so a partial match leaves the importer's `./` in front
      // of an absolute path.
      { find: /^.*\/fontSources$/, replacement: path.resolve(__dirname, 'src/utils/text/fontSources.viewer.ts') },
      { find: /^.*\/mathjaxEngine$/, replacement: path.resolve(__dirname, 'src/services/mathjaxEngine.viewer.ts') },
    ],
  },
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
