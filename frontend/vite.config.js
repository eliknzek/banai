import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5173 },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.js'],
    setupFiles: ['tests/unit/setup/locale.js'],
    coverage: { provider: 'v8', include: ['src/**/*.js'], thresholds: { 'src/domain/**': { lines: 80 } } },
  },
});
