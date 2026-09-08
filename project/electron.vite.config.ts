import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

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
    build: {
      outDir: 'out/renderer',
      rollupOptions: { input: 'renderer/index.html' }
    }
  }
})
