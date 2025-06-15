import { defineConfig } from 'vite'
import markdown from 'vite-plugin-md'

export default defineConfig({
  plugins: [
    markdown() // 启用 Markdown 支持
  ],
  base: './', // 确保 GitHub Pages 路径正确
  build: {
    outDir: 'dist' // 输出目录
  }
})
