import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [react(), VitePWA({
    registerType: 'prompt',
    includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'],
    manifest: {
      name: 'BrainRivals — Think fast. Play together.', short_name: 'BrainRivals',
      description: 'Offline and online quiz battles with friends.',
      theme_color: '#10111d', background_color: '#10111d', display: 'standalone',
      orientation: 'portrait', start_url: '/',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
      ]
    },
    workbox: { globPatterns: ['**/*.{js,css,html,svg,png,woff2}'], navigateFallbackDenylist: [/^\/socket\.io/, /^\/health/] }
  })],
  server: { port: 5173, proxy: { '/socket.io': { target: 'http://127.0.0.1:3001', ws: true }, '/health': 'http://127.0.0.1:3001' } },
  build: { target: 'es2022' }
});