import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const shared = fileURLToPath(new URL('./shared', import.meta.url))

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main',
      rollupOptions: { input: { index: 'main/index.ts' } }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      rollupOptions: { input: { index: 'preload/index.ts' } }
    }
  },
  renderer: {
    plugins: [react()],
    root: 'renderer',
    resolve: { alias: { '@shared': shared } },
    build: {
      outDir: 'out/renderer',
      rollupOptions: { input: 'renderer/index.html' }
    }
  }
})
