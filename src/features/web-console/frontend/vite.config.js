import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))
const require = createRequire(import.meta.url)
const dependencies = dirname(dirname(require.resolve('vite/package.json')))

export default defineConfig({
  root,
  plugins: [vue()],
  server: {
    host: '127.0.0.1',
    port: Number(process.env.WEB_CONSOLE_FRONTEND_PORT ?? 4301),
    fs: { allow: [fileURLToPath(new URL('../../../..', import.meta.url)), dependencies] },
    proxy: {
      '/api': {
        target: process.env.WEB_CONSOLE_API_URL ?? 'http://127.0.0.1:4300',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: fileURLToPath(new URL('../../../../dist/web-console', import.meta.url)),
    emptyOutDir: true
  }
})
