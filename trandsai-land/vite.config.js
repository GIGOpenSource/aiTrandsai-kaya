import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'
import path from 'path'

export default defineConfig({
  plugins: [uni()],
  transpileDependencies: ['uview-plus', 'lime-painter'],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './')
    }
  }
})