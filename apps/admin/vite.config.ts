import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      // In development the dashboard talks to the local API through Vite, so no
      // CORS configuration is needed. Production sets VITE_API_URL instead.
      // 127.0.0.1, not localhost: Node 17+ resolves localhost to ::1 first,
      // and the API listens on IPv4 only.
      '/api': { target: 'http://127.0.0.1:4000', changeOrigin: true },
    },
  },
  optimizeDeps: { include: ['@bday/shared'] },
  build: {
    commonjsOptions: { include: [/shared/, /node_modules/] },
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query'],
          charts: ['recharts'],
        },
      },
    },
  },
});
