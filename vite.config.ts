import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Fix: Cast `process` to `any` to access `cwd()` and resolve a TypeScript error. `process.cwd()` is valid in the Node.js context for a Vite config file, but the type definitions for `process` are incomplete in this environment.
  const env = loadEnv(mode, (process as any).cwd(), '');
  return {
    plugins: [react()],
    define: {
      'process.env.API_KEY': JSON.stringify(env.API_KEY)
    }
  }
});
