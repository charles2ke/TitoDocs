import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// `root` is relative to the working directory; server/index.ts passes an absolute root in development.
export default defineConfig({
  root: 'client',
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
  },
});
