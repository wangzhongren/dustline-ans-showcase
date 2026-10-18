/**
 * 素材加载 Provider 公共入口。
 *
 * 上层通过 `createAssetLoader()` 读取 `asset-manifest.json` 并加载贴图、
 * HDR 与 GLB；不要直接读取 `resource/` 或导入 `impl/`。
 */

import { createThreeAssetLoader } from '../impl/three-assets.js';

/**
 * 创建素材加载器。工厂本身不发起网络请求，也不访问 `document`。
 *
 * @param {import('../abstract/assets.js').CreateAssetLoaderOptions} [options]
 * @returns {import('../abstract/assets.js').AssetLoader}
 */
export function createAssetLoader(options) {
  return createThreeAssetLoader(options);
}
