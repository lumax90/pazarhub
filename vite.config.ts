import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'react-vendor',
              test: /node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/,
              priority: 20,
              includeDependenciesRecursively: false,
            },
            {
              name: 'motion-vendor',
              test: /node_modules[\\/](motion|framer-motion|motion-dom|motion-utils)[\\/]/,
              priority: 15,
              includeDependenciesRecursively: false,
            },
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:3001', '/media': 'http://127.0.0.1:3001' },
  },
  preview: { port: 4173, strictPort: true },
})
