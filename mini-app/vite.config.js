import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import { readFileSync } from 'fs'

const { version } = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'))

export default defineConfig({
  base: '/app/',
  plugins: [vue()],
  define: {
    // Единственный источник версии — package.json, чтобы не разъезжаться
    // с ним при следующем бампе. Строка уже с кавычками (JSON.stringify) —
    // define подставляет её как есть, а не как JS-выражение.
    __APP_VERSION__: JSON.stringify(version),
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
})
