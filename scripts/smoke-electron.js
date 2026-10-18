/**
 * Electron 启动冒烟。
 *
 * 启动真实的构建产物（不是 mock）：`npm run build` 后由 playwright-core 的
 * `_electron.launch({ args: ['.'] })` 打开桌面窗口，检查标题、canvas、开始按钮、
 * O4（含 getSettings/getPerformance）、设置面板与低画质后处理开关，点击开始后
 * 通过 O4 只读钩子读取对局状态与 HUD。
 *
 * 运行：node scripts/smoke-electron.js
 * 失败时打印具体原因并以非零码退出。
 */

import path from 'node:path';
import process from 'node:process';
import { existsSync } from 'node:fs';

import { _electron as electron } from 'playwright-core';

const projectRoot = process.cwd();
const distIndex = path.join(projectRoot, 'dist', 'index.html');

let failures = 0;

/**
 * @param {boolean} condition
 * @param {string} label
 * @param {string} [detail]
 * @returns {void}
 */
function report(condition, label, detail) {
  if (condition) {
    console.log('PASS: ' + label);
    return;
  }
  failures += 1;
  let suffix = '';
  if (typeof detail === 'string' && detail.length > 0) {
    suffix = ' — ' + detail;
  }
  console.error('FAIL: ' + label + suffix);
}

/**
 * 等待测试钩子中的对局状态。
 *
 * @param {import('playwright-core').Page} page
 * @param {string} expected
 * @returns {Promise<void>}
 */
async function waitForState(page, expected) {
  await page.waitForFunction(
    (target) => {
      const api = window.__DUSTLINE_TEST__;
      if (api === undefined) {
        return false;
      }
      return api.getState() === target;
    },
    expected,
    { timeout: 20000 }
  );
}

async function main() {
  if (!existsSync(distIndex)) {
    console.error('FAIL: 构建产物不存在：' + distIndex);
    console.error('请先运行 npm run build，再运行 node scripts/smoke-electron.js');
    process.exit(1);
  }

  console.log('INFO: 启动 Electron，项目目录 ' + projectRoot);
  let electronApp = null;

  try {
    electronApp = await electron.launch({
      args: ['.'],
      env: { ...process.env, DUSTLINE_TEST: '1' }
    });

    const page = await electronApp.firstWindow();
    page.on('console', (message) => {
      if (message.type() === 'error') {
        console.error('PAGE CONSOLE ERROR: ' + message.text());
      }
    });
    page.on('pageerror', (error) => {
      console.error('PAGE EXCEPTION: ' + error.message);
    });

    await page.waitForLoadState('domcontentloaded');

    const title = await page.title();
    report(
      title.includes('DUSTLINE'),
      '窗口标题包含 DUSTLINE',
      '实际标题：' + title
    );
    console.log('INFO: 实际标题 ' + title);

    const canvasCount = await page.locator('canvas#game').count();
    report(canvasCount === 1, '存在 canvas#game', '数量：' + canvasCount);

    await page.waitForSelector('#loading', { state: 'hidden', timeout: 120000 });
    report(true, '训练场装载完成，装载层已隐藏');

    await page.waitForSelector('#start-btn', { state: 'visible', timeout: 30000 });
    const startEnabled = await page.isEnabled('#start-btn');
    report(startEnabled, '开始按钮可见且已启用');

    const hookExists = await page.evaluate(() => {
      return typeof window.__DUSTLINE_TEST__ === 'object';
    });
    report(hookExists, 'O4 测试钩子 window.__DUSTLINE_TEST__ 已暴露');

    const settingsHook = await page.evaluate(() => {
      const api = window.__DUSTLINE_TEST__;
      return {
        settingsExists: typeof api.getSettings === 'function',
        performanceExists: typeof api.getPerformance === 'function',
        settings: api.getSettings(),
        performance: api.getPerformance()
      };
    });
    report(settingsHook.settingsExists, 'O4 getSettings() 已暴露');
    report(settingsHook.performanceExists, 'O4 getPerformance() 已暴露');
    report(
      settingsHook.settings !== null &&
        typeof settingsHook.settings === 'object' &&
        typeof settingsHook.settings.fov === 'number' &&
        typeof settingsHook.settings.quality === 'string',
      'O4 getSettings() 返回完整设置',
      JSON.stringify(settingsHook.settings)
    );
    report(
      settingsHook.performance !== null &&
        typeof settingsHook.performance === 'object' &&
        typeof settingsHook.performance.fps === 'number',
      'O4 getPerformance() 返回性能仪表',
      JSON.stringify(settingsHook.performance)
    );

    await page.click('#menu-settings-btn');
    await page.waitForSelector('#settings', { state: 'visible', timeout: 10000 });
    const settingsHud = await page.evaluate(() => {
      return window.__DUSTLINE_TEST__.getHud();
    });
    report(settingsHud.settingsVisible === true, '菜单“设置”打开设置面板');
    report(
      settingsHud.menuVisible === true,
      '设置面板打开时主菜单仍保留在背景'
    );

    await page.selectOption('#setting-quality', 'low');
    await page.waitForFunction(
      () => window.__DUSTLINE_TEST__.getSettings().quality === 'low',
      undefined,
      { timeout: 10000 }
    );
    const lowQuality = await page.evaluate(() => {
      const api = window.__DUSTLINE_TEST__;
      return {
        settings: api.getSettings(),
        performance: api.getPerformance(),
        stored: window.localStorage.getItem('dustline.settings.v3')
      };
    });
    report(lowQuality.settings.quality === 'low', '设置面板切换画质为 low');
    report(
      lowQuality.performance.quality === 'low',
      '低画质已转发到渲染器',
      JSON.stringify(lowQuality.performance)
    );
    report(
      lowQuality.performance.postProcessing === false,
      '低画质关闭后处理',
      JSON.stringify(lowQuality.performance)
    );
    report(
      typeof lowQuality.stored === 'string' && lowQuality.stored.includes('"quality":"low"'),
      '设置写入 localStorage 键 dustline.settings.v3'
    );

    await page.click('#settings-reset');
    await page.waitForFunction(
      () => window.__DUSTLINE_TEST__.getSettings().quality === 'high',
      undefined,
      { timeout: 10000 }
    );
    report(true, '恢复默认设置把画质改回 high');

    await page.click('#settings-close');
    await page.waitForSelector('#settings', { state: 'hidden', timeout: 10000 });
    const settingsClosedHud = await page.evaluate(() => {
      return window.__DUSTLINE_TEST__.getHud();
    });
    report(settingsClosedHud.settingsVisible === false, '关闭设置面板后 HUD 状态复位');

    await page.click('#start-btn');
    await waitForState(page, 'playing');
    report(true, '点击开始后对局状态为 playing');

    const hud = await page.evaluate(() => {
      return window.__DUSTLINE_TEST__.getHud();
    });
    console.log('INFO: HUD = ' + JSON.stringify(hud));

    report(hud.state === 'playing', 'HUD 状态为 playing', '实际：' + String(hud.state));
    report(hud.menuVisible === false, '开始后主菜单隐藏');
    report(hud.pausedVisible === false, '开始后暂停层隐藏');
    report(hud.gameoverVisible === false, '开始后结算层隐藏');
    report(
      typeof hud.health === 'number' && hud.health > 0,
      'HUD 生命值大于 0',
      '实际：' + String(hud.health)
    );
    report(
      typeof hud.ammo === 'number' && hud.ammo >= 0,
      'HUD 弹药数为非负数字',
      '实际：' + String(hud.ammo)
    );
    report(hud.wave >= 1, 'HUD 波次从第 1 波开始', '实际：' + String(hud.wave));

    const snapshot = await page.evaluate(() => {
      return window.__DUSTLINE_TEST__.getSnapshot();
    });
    const snapshotValid = await page.evaluate((value) => {
      if (value === null || typeof value !== 'object') {
        return false;
      }
      return value.state === 'playing' && typeof value.player === 'object';
    }, snapshot);
    report(snapshotValid, 'O4 getSnapshot() 返回 playing 对局快照');
  } catch (error) {
    failures += 1;
    console.error('FAIL: Electron 冒烟启动或检查失败');
    console.error(error);
  } finally {
    if (electronApp !== null) {
      try {
        await electronApp.close();
        console.log('INFO: Electron 已关闭');
      } catch (error) {
        console.error('WARN: 关闭 Electron 失败', error);
      }
    }
  }

  if (failures > 0) {
    console.error('FAIL: 冒烟共 ' + failures + ' 项失败');
    process.exit(1);
  }

  console.log('PASS: Electron 启动冒烟全部通过');
}

main().catch((error) => {
  console.error('FAIL: 冒烟脚本未捕获错误', error);
  process.exit(1);
});
