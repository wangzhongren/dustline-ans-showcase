/**
 * 目录入口，让 `node --test test/界面装配/` 在把目录参数当作模块加载的 Node 版本中
 * 仍能找到本角色的真实测试文件。断言分别位于 HUD 格式化与设置存储测试中。
 */

import './hud-format.test.js';
import './settings.test.js';
