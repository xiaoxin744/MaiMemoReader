import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * base 默认 './'，同一份构建产物既能跑在本地，也能直接放进 GitHub Pages 的仓库子路径。
 * 需要在 Actions 里指定绝对路径时，设置环境变量 VITE_BASE=/<repo>/。
 */
export default defineConfig({
  base: process.env.VITE_BASE ?? './',
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
  },
  preview: {
    host: true,
    port: 4173,
  },
  build: {
    target: 'es2020',
    cssTarget: 'safari15',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
});
