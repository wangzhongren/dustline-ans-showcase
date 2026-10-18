/**
 * 渲染 Provider 公共入口。
 *
 * 上层（Service / Pipeline / 界面装配）只能从这里获得渲染器；不要导入
 * `src/providers/impl/` 或直接使用 `WebGLRenderer`。
 */

import { createThreeRenderer } from '../impl/three-renderer.js';

/**
 * 创建项目渲染器。调用前必须准备好 HTMLCanvasElement；本函数会创建 WebGL 上下文。
 *
 * @param {import('../abstract/renderer.js').CreateRendererOptions} options
 * @returns {import('../abstract/renderer.js').Renderer}
 */
export function createRenderer(options) {
  return createThreeRenderer(options);
}
