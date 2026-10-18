/**
 * Vite 构建配置。
 *
 * 渲染进程使用 `base: './'`，让构建后的 index.html 以相对路径加载脚本和样式，
 * 从而能通过 Electron 的 `app://dustline/` 协议（或 file://）打开。
 *
 * `resource/` 不交给 Vite 的 publicDir，因为 publicDir 会把内容复制到 dist 根目录，
 * 而运行时统一按 `./resource/...` 访问。开发服务器会直接从项目根提供 `/resource/`；
 * 构建时由下面的插件把整个目录复制到 `dist/resource/`，保持两种模式 URL 一致。
 */

import path from 'node:path';
import { cpSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

/**
 * 构建结束后复制 CC0 素材目录。
 *
 * 插件只在 build 阶段生效；`closeBundle` 时 dist 已经写完，复制不会被 emptyOutDir 清掉。
 *
 * @returns {{ name: string, apply: 'build', closeBundle: () => void }}
 */
function copyResourceDirectory() {
  return {
    name: 'dustline-copy-resource',
    apply: 'build',
    closeBundle() {
      const source = path.join(projectRoot, 'resource');
      const target = path.join(projectRoot, 'dist', 'resource');

      if (!existsSync(source)) {
        console.warn('[vite] resource/ 不存在，跳过素材复制；游戏会使用程序化回退材质');
        return;
      }

      try {
        cpSync(source, target, { recursive: true });
        console.log('[vite] 已复制 resource/ → dist/resource/');
      } catch (error) {
        console.error('[vite] 复制 resource/ 失败', error);
        throw error;
      }
    }
  };
}

export default defineConfig({
  base: './',
  publicDir: false,
  plugins: [copyResourceDirectory()],
  build: {
    outDir: 'dist',
    emptyOutDir: true
  },
  server: {
    port: 5173,
    strictPort: true
  }
});
