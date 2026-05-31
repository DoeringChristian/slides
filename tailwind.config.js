import plugin from 'tailwindcss/plugin'

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [
    // `coarse:` — applies under `@media (pointer: coarse)`, i.e. touch devices.
    // Use this to always-reveal hover-only affordances on touch, e.g.
    // `opacity-0 group-hover:opacity-100 coarse:opacity-100`.
    plugin(function ({ addVariant }) {
      addVariant('coarse', '@media (pointer: coarse)')
      addVariant('fine', '@media (pointer: fine)')
    }),
  ],
}
