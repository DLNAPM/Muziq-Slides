
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, (process as any).cwd(), '');

  // Logic to handle Render Secret Files
  // If authToken is a path, read the file content.
  let authTokenValue = env.authToken || '';
  if (authTokenValue && (authTokenValue.startsWith('/') || authTokenValue.startsWith('./'))) {
    try {
      const resolvedPath = path.resolve((process as any).cwd(), authTokenValue);
      if (fs.existsSync(resolvedPath)) {
        authTokenValue = fs.readFileSync(resolvedPath, 'utf-8');
      }
    } catch (err) {
      console.error('Error reading Apple Auth Token from secret file:', err);
    }
  }

  return {
    plugins: [react()],
    define: {
      'process.env.API_KEY': JSON.stringify(env.API_KEY),
      'process.env.TEAM_ID': JSON.stringify(env.teamId),
      'process.env.KEY_ID': JSON.stringify(env.keyId),
      'process.env.AUTH_TOKEN': JSON.stringify(authTokenValue),
    }
  }
});
