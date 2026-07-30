import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Capacitor 从 file:///https://localhost 加载，需相对路径以兼容 Android WebView
  base: './',
  server: {
    port: 5173,
  },
})
