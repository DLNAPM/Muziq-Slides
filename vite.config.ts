
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, (process as any).cwd(), '');
  return {
    plugins: [react()],
    define: {
      'process.env.API_KEY': JSON.stringify(env.API_KEY),
      'process.env.TEAM_ID': JSON.stringify(env.teamId),
      'process.env.KEY_ID': JSON.stringify(env.keyId),
      'process.env.AUTH_TOKEN': JSON.stringify(env.authToken),
    }
  }
});
