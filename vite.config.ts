import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  const analytics = env.ANALYTICS_UPSTREAM_URL || 'http://127.0.0.1:3100';
  const reporting = '^/(app|_next|login|mfa|auth/complete|api/workspaces|api/connections/google|api/auth/state)(/|\\?|$)';
  return {
    plugins: [react()],
    server: {
      port: Number(env.VITE_PORT || 5174),
      strictPort: true,
      proxy: {
        [reporting]: { target: analytics, changeOrigin: true, ws: true },
        ...(env.CRM_AUTH_MODE === 'supabase'
          ? { '^/api/auth/(login|logout)/?$': { target: analytics, changeOrigin: true } }
          : {}),
        '/api': `http://127.0.0.1:${env.PORT || 3001}`,
      },
    },
  };
});
