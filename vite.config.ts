import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5173, strictPort: false },
  build: { outDir: 'dist', target: 'es2022' },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
