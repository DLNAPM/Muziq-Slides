import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
// Fix: Explicitly import 'cwd' from Node's 'process' module to resolve type errors for process.cwd().
import { cwd } from 'node:process'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, cwd(), '');
  return {
    plugins: [react()],
    define: {
      'process.env.API_KEY': JSON.stringify(env.API_KEY)
    }
  }
});
