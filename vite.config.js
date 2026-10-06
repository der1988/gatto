import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.FELIS_BASE_PATH || '/',
  build: { target: 'es2022' },
});
