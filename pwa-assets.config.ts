import {
  defineConfig,
  minimal2023Preset as preset,
} from '@vite-pwa/assets-generator/config'

// Generate PWA icons from public/icon.svg → 64, 192, 512, apple-touch-icon,
// maskable. Run with: `npx pwa-assets-generator` (or via the npm script).
export default defineConfig({
  preset,
  images: ['public/icon.svg'],
})
