/// <reference types="vite/client" />

declare const __SLIDES_STANDALONE_BUILD__: boolean
declare const __SLIDES_EDITOR_ORIGIN__: string

declare module '*?raw' {
  const content: string
  export default content
}
