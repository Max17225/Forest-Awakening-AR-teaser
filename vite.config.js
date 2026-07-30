import { defineConfig } from 'vite'

// Vite static build for Vercel + local HTTPS testing via ngrok.
export default defineConfig({
  base: './',
  server: {
    // Allow any host (needed for ngrok / tunnel URLs during mobile AR testing).
    allowedHosts: true,
  },
})
