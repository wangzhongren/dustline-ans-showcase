/**
 * 独立测试：Electron 端到端完整流程（v3）。
 *
 * 从项目根目录启动真实 Electron 应用（electron/main.js + dist），通过 O4 只读
 * 测试钩子 `window.__DUSTLINE_TEST__` 读取状态，不添加任何写入钩子。设置面板
 * 只通过真实 DOM 控件修改，并读取 localStorage 验证持久化。
 *
 * 前置条件：
 * - 已执行 `npm run build`，存在 `dist/index.html` 与 `dist/resource/`。
 * - `DUSTLINE_TEST=1` 时 electron/main.js 才加载 `?test=1` 并暴露只读钩子。
 *
 * 运行（项目根目录）：
 *   node --test test/独立测试/e2e/electron-smoke.test.js
 *
 * 截图输出：test/独立测试/fixtures/screenshots-v3/（不覆盖 v2 截图）；
 * ADS 黑镜修复回归另存到 fixtures/screenshots-v3-ads-fix/。
 *
 * 指针锁定：Playwright 启动的窗口在部分桌面会话中不会自动获得焦点，Chromium
 * 会以 WrongDocumentError 拒绝 pointer lock；启动后显式 show/focus 窗口，
 * 并在 ADS 用例中确认锁定，无法锁定时如实标记 NOT RUN。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { _electron as electron } from 'playwright-core';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(TEST_DIR, '../../..');
const SCREENSHOT_DIR = path.resolve(TEST_DIR, '../fixtures/screenshots-v3');
const ADS_FIX_SCREENSHOT_DIR = path.resolve(
  TEST_DIR,
  '../fixtures/screenshots-v3-ads-fix'
);

/** 完整流程测试的死亡观察上限（毫秒）。 */
const DEATH_TIMEOUT_MS = 90000;

/** 性能采样时长（毫秒）。 */
const PERFORMANCE_SAMPLE_MS = 3000;

/** ADS 中心采样裁剪边长（CSS 像素）。 */
const ADS_CLIP_SIZE = 160;

/** ADS 中心平均亮度下限（0–255 sRGB）。 */
const ADS_MIN_LUMINANCE = 40;

/**
 * 镜片中心 40×40 区域的平均亮度下限。修复前的实心镜体中心约为 32/255
 * （20×20）到 53/255（40×40，含明亮镜框边缘），修复后约 99–113；
 * 60 能区分“中心仍被黑色实心块遮挡”，同时给场景明暗留出余量。
 */
const ADS_MIN_INNER_LUMINANCE = 60;

/** 修复前证据（只读来源；复制到本角色夹具目录，不覆盖来源）。 */
const ADS_BEFORE_SOURCE = path.resolve(
  PROJECT_ROOT,
  'test/战斗服务/evidence/ads-fix/ads-before.png'
);

/**
 * 启动真实 Electron 应用并等待页面加载。
 *
 * @returns {Promise<{app: Object, window: Object, consoleMessages: Array<Object>}>}
 */
async function launchApp() {
  const app = await electron.launch({
    args: ['.'],
    cwd: PROJECT_ROOT,
    env: { ...process.env, DUSTLINE_TEST: '1' },
    timeout: 60000
  });
  const window = await app.firstWindow({ timeout: 60000 });
  const consoleMessages = [];
  window.on('console', function captureConsole(message) {
    consoleMessages.push({ type: message.type(), text: message.text() });
  });
  window.on('pageerror', function capturePageError(error) {
    consoleMessages.push({ type: 'pageerror', text: error.message });
  });
  await window.waitForLoadState('domcontentloaded');
  // Playwright 启动的 Electron 窗口在部分桌面会话中不会自动获得焦点；
  // 未聚焦时 Chromium 会以 WrongDocumentError 拒绝 pointer lock。
  // 真实玩家会看到并激活窗口，这里显式显示并聚焦，保证自动化输入与真实窗口一致。
  await window.bringToFront();
  await app.evaluate(({ BrowserWindow }) => {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
      windows[0].show();
      windows[0].focus();
    }
  });
  return { app, window, consoleMessages };
}

/**
 * 确保 canvas 已获得指针锁定；未锁定时用真实画布点击重试一次。
 * 返回实际锁定元素，供调用方决定继续或标记 NOT RUN。
 *
 * @param {{app: Object, window: Object}} session
 * @returns {Promise<{locked: boolean, element: string|null, hasFocus: boolean}>}
 */
async function ensurePointerLock(session) {
  const readLock = () =>
    session.window.evaluate(() =>
      document.pointerLockElement === null ? null : document.pointerLockElement.id
    );

  let element = await readLock();
  if (element === null) {
    await session.window.bringToFront();
    await session.app.evaluate(({ BrowserWindow }) => {
      const windows = BrowserWindow.getAllWindows();
      if (windows.length > 0) {
        windows[0].show();
        windows[0].focus();
      }
    });
    await session.window.waitForTimeout(300);
    const box = await session.window.locator('#game').boundingBox();
    const x = box === null ? 800 : box.x + box.width / 2;
    const y = box === null ? 450 : box.y + box.height / 2;
    // 未锁定时，左键按下只会请求锁定，不会开火（input.js 的既有行为）。
    await session.window.mouse.click(x, y);
    await session.window.waitForTimeout(1500);
    element = await readLock();
  }
  const hasFocus = await session.window.evaluate(() => document.hasFocus());
  return { locked: element !== null, element, hasFocus };
}

/**
 * 等待装载完成与 O4 只读钩子可用。
 *
 * @param {Object} window
 * @returns {Promise<void>}
 */
async function waitForReady(window) {
  await window.waitForFunction(
    () => typeof window.__DUSTLINE_TEST__ === 'object',
    null,
    { timeout: 30000 }
  );
  await window.waitForFunction(
    () => {
      const loading = document.getElementById('loading');
      return loading !== null && loading.classList.contains('hidden');
    },
    null,
    { timeout: 30000 }
  );
  await window.waitForFunction(
    () => {
      const button = document.getElementById('start-btn');
      return button !== null && button.disabled === false;
    },
    null,
    { timeout: 30000 }
  );
}

/**
 * @param {Object} window
 * @returns {Promise<Object>}
 */
function readSnapshot(window) {
  return window.evaluate(() => window.__DUSTLINE_TEST__.getSnapshot());
}

/**
 * @param {Object} window
 * @returns {Promise<Object>}
 */
function readHud(window) {
  return window.evaluate(() => window.__DUSTLINE_TEST__.getHud());
}

/**
 * @param {Object} window
 * @returns {Promise<string>}
 */
function readState(window) {
  return window.evaluate(() => window.__DUSTLINE_TEST__.getState());
}

/**
 * @param {Object} window
 * @returns {Promise<Object>}
 */
function readSettings(window) {
  return window.evaluate(() => window.__DUSTLINE_TEST__.getSettings());
}

/**
 * @param {Object} window
 * @returns {Promise<Object>}
 */
function readPerformance(window) {
  return window.evaluate(() => window.__DUSTLINE_TEST__.getPerformance());
}

/**
 * 在页面内用 `createImageBitmap` + `OffscreenCanvas` 解码截图缓冲，统计中心
 * 裁剪的平均亮度、方差、唯一颜色数与红点像素。
 *
 * @param {Object} window
 * @param {Buffer} buffer Playwright 截图返回的 PNG 缓冲
 * @returns {Promise<Object>}
 */
function analyzeAdsCenterClip(window, buffer) {
  const base64 = buffer.toString('base64');
  return window.evaluate(async (encoded) => {
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    const image = context.getImageData(0, 0, bitmap.width, bitmap.height);
    const width = image.width;
    const height = image.height;
    const data = image.data;

    let luminanceSum = 0;
    let luminanceSquareSum = 0;
    let maxR = 0;
    let redCount = 0;
    let strongRedCount = 0;
    let strongRedSumX = 0;
    let strongRedSumY = 0;
    let brightestRed = null;
    const colors = new Set();

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        const r = data[offset];
        const g = data[offset + 1];
        const b = data[offset + 2];
        const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        luminanceSum += luminance;
        luminanceSquareSum += luminance * luminance;
        if (r > maxR) {
          maxR = r;
        }
        if (r > 120 && r > g * 1.4 && r > b * 1.4) {
          redCount += 1;
          if (r > 180 && r > g * 1.8 && r > b * 1.8) {
            strongRedCount += 1;
            strongRedSumX += x;
            strongRedSumY += y;
            if (brightestRed === null || r > brightestRed.r) {
              brightestRed = { x, y, r, g, b };
            }
          }
        }
        colors.add(((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2));
      }
    }

    const total = width * height;
    const averageLuminance = luminanceSum / total;
    const variance = Math.max(
      0,
      luminanceSquareSum / total - averageLuminance * averageLuminance
    );

    /**
     * 统计以 (centerX, centerY) 为中心的方形区域：红点像素、平均亮度、
     * 方差与唯一颜色数。用于直接采样镜片中心，而不是只看整张截图。
     *
     * @param {number} centerX
     * @param {number} centerY
     * @param {number} size
     * @returns {Object}
     */
    function inspectRegion(centerX, centerY, size) {
      const half = Math.floor(size / 2);
      const startX = Math.max(0, centerX - half);
      const endX = Math.min(width, centerX + half);
      const startY = Math.max(0, centerY - half);
      const endY = Math.min(height, centerY + half);
      let count = 0;
      let regionMaxR = 0;
      let regionLuminanceSum = 0;
      let regionLuminanceSquareSum = 0;
      let regionPixels = 0;
      const regionColors = new Set();
      for (let y = startY; y < endY; y += 1) {
        for (let x = startX; x < endX; x += 1) {
          const offset = (y * width + x) * 4;
          const r = data[offset];
          const g = data[offset + 1];
          const b = data[offset + 2];
          const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          regionLuminanceSum += luminance;
          regionLuminanceSquareSum += luminance * luminance;
          regionPixels += 1;
          regionColors.add(((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2));
          if (r > regionMaxR) {
            regionMaxR = r;
          }
          if (r > 120 && r > g * 1.4 && r > b * 1.4) {
            count += 1;
          }
        }
      }
      const averageLuminance = regionPixels === 0 ? 0 : regionLuminanceSum / regionPixels;
      return {
        size,
        centerX,
        centerY,
        count,
        maxR: regionMaxR,
        averageLuminance,
        variance: Math.max(
          0,
          regionLuminanceSquareSum / regionPixels - averageLuminance * averageLuminance
        ),
        uniqueColors: regionColors.size
      };
    }

    const clipCenterX = Math.round(width / 2);
    const clipCenterY = Math.round(height / 2);
    const strongRedCentroid =
      strongRedCount > 0
        ? {
            x: Math.round(strongRedSumX / strongRedCount),
            y: Math.round(strongRedSumY / strongRedCount)
          }
        : null;

    return {
      width,
      height,
      averageLuminance,
      variance,
      maxR,
      redCount,
      strongRedCount,
      strongRedCentroid,
      brightestRed,
      uniqueColors: colors.size,
      inner40: inspectRegion(clipCenterX, clipCenterY, 40),
      centroid40:
        strongRedCentroid === null
          ? null
          : inspectRegion(strongRedCentroid.x, strongRedCentroid.y, 40)
    };
  }, base64);
}

/**
 * 等待 HUD、武器快照与准星同时进入 ADS 状态。
 *
 * @param {Object} window
 * @returns {Promise<void>}
 */
async function waitForAdsState(window) {
  await window.waitForFunction(
    () => {
      const hud = window.__DUSTLINE_TEST__.getHud();
      const weapon = window.__DUSTLINE_TEST__.getSnapshot().weapon;
      const crosshair = document.querySelector('.crosshair');
      const indicator = document.getElementById('ads-indicator');
      return (
        hud.aiming === true &&
        weapon.aiming === true &&
        crosshair !== null &&
        crosshair.classList.contains('aiming') === true &&
        indicator !== null &&
        indicator.classList.contains('hidden') === false
      );
    },
    null,
    { timeout: 5000, polling: 50 }
  );
}

/**
 * 等待 HUD、武器快照与准星退出 ADS 状态。
 *
 * @param {Object} window
 * @returns {Promise<void>}
 */
async function waitForHipState(window) {
  await window.waitForFunction(
    () => {
      const hud = window.__DUSTLINE_TEST__.getHud();
      const weapon = window.__DUSTLINE_TEST__.getSnapshot().weapon;
      const crosshair = document.querySelector('.crosshair');
      return (
        hud.aiming === false &&
        weapon.aiming === false &&
        crosshair !== null &&
        crosshair.classList.contains('aiming') === false
      );
    },
    null,
    { timeout: 5000, polling: 50 }
  );
}

/**
 * 等待某个对局状态出现；超时返回 false 并保留最后一次状态。
 *
 * @param {Object} window
 * @param {string} expected
 * @param {number} timeoutMs
 * @returns {Promise<{reached: boolean, lastState: string}>}
 */
async function waitForState(window, expected, timeoutMs) {
  let lastState = 'unknown';
  try {
    await window.waitForFunction(
      (target) => window.__DUSTLINE_TEST__.getState() === target,
      expected,
      { timeout: timeoutMs, polling: 100 }
    );
    return { reached: true, lastState: expected };
  } catch (error) {
    lastState = await readState(window);
    console.log(
      '[e2e] 等待状态 ' + expected + ' 超时，最后状态 ' + lastState + '：' +
        String(error.message)
    );
    return { reached: false, lastState };
  }
}

/**
 * 等待场上至少存在指定数量的存活敌人。
 *
 * @param {Object} window
 * @param {number} minimum
 * @param {number} [timeoutMs]
 * @returns {Promise<Object>}
 */
async function waitForEnemies(window, minimum, timeoutMs) {
  const limit = timeoutMs === undefined ? 30000 : timeoutMs;
  await window.waitForFunction(
    (target) => window.__DUSTLINE_TEST__.getSnapshot().enemies.alive >= target,
    minimum,
    { timeout: limit, polling: 100 }
  );
  return readSnapshot(window);
}

/**
 * 点击开始按钮并等待进入对局。
 *
 * @param {Object} window
 * @returns {Promise<void>}
 */
async function startMatch(window) {
  await window.locator('#start-btn').click();
  const result = await waitForState(window, 'playing', 15000);
  const snapshot = await readSnapshot(window);
  assert.equal(
    result.reached,
    true,
    '点击开始后应进入 playing，最后状态 ' + result.lastState +
      '，快照 ' + JSON.stringify(snapshot)
  );
}

/**
 * 通过真实 DOM 控件设置 range 滑杆，并触发 input 事件。
 *
 * @param {Object} window
 * @param {string} selector
 * @param {number} value
 * @returns {Promise<void>}
 */
async function setRangeValue(window, selector, value) {
  await window.locator(selector).evaluate((element, next) => {
    element.value = String(next);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

/**
 * 读取指定设置项的滑杆值与显示值。
 *
 * @param {Object} window
 * @param {string} selector
 * @param {string} outputSelector
 * @returns {Promise<{value: string, output: string}>}
 */
function readRangeDisplay(window, selector, outputSelector) {
  return window.evaluate(
    (options) => {
      const input = document.querySelector(options.selector);
      const output = document.querySelector(options.outputSelector);
      return {
        value: input === null ? null : input.value,
        output: output === null ? null : output.textContent
      };
    },
    { selector, outputSelector }
  );
}

/**
 * 在页面内采样性能仪表一段时间。返回原始 FPS 样本、frameCount 增量与
 * 由 frameCount/墙钟时间计算的实测帧率。
 *
 * @param {Object} window
 * @param {number} durationMs
 * @returns {Promise<Object>}
 */
function samplePerformance(window, durationMs) {
  return window.evaluate(async (duration) => {
    const api = window.__DUSTLINE_TEST__;
    const start = performance.now();
    const startFrame = api.getPerformance().frameCount;
    const samples = [];
    while (performance.now() - start < duration) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const perf = api.getPerformance();
      samples.push({
        atMs: Math.round(performance.now() - start),
        fps: perf.fps,
        enemyCount: perf.enemyCount,
        quality: perf.quality,
        postProcessing: perf.postProcessing
      });
    }
    const end = performance.now();
    const final = api.getPerformance();
    return {
      samples,
      frameDelta: final.frameCount - startFrame,
      wallSeconds: (end - start) / 1000,
      measuredFps: (final.frameCount - startFrame) / ((end - start) / 1000),
      final,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      devicePixelRatio: window.devicePixelRatio
    };
  }, durationMs);
}

/**
 * 观察玩家静止时是否在限时内被敌人击杀。
 *
 * @param {Object} window
 * @param {number} timeoutMs
 * @param {(message: string) => void} diagnostic
 * @returns {Promise<{reached: boolean, samples: Array<Object>}>}
 */
async function waitForDeath(window, timeoutMs, diagnostic) {
  const startedAt = Date.now();
  const samples = [];
  while (Date.now() - startedAt < timeoutMs) {
    const state = await readState(window);
    const snapshot = await readSnapshot(window);
    samples.push({
      seconds: Math.round((Date.now() - startedAt) / 1000),
      state,
      health: snapshot.player.health
    });
    if (state === 'over') {
      return { reached: true, samples };
    }
    if (state === 'paused') {
      const resumeVisible = await window.locator('#resume-btn').isVisible();
      if (resumeVisible === true) {
        diagnostic('指针锁定丢失导致暂停，点击继续后继续观察死亡流程');
        await window.locator('#resume-btn').click();
      }
    }
    await window.waitForTimeout(2000);
  }
  return { reached: false, samples };
}

/**
 * 通过窗口 mousemove 事件把视角水平转动指定像素增量（真实输入监听器消费）。
 * 每 714 像素约等于 90°，用于环视寻找人类士兵。
 *
 * @param {Object} window
 * @param {number} movementX
 * @returns {Promise<void>}
 */
async function turnByMovement(window, movementX) {
  await window.evaluate((delta) => {
    window.dispatchEvent(
      new MouseEvent('mousemove', {
        movementX: delta,
        movementY: 0,
        bubbles: true
      })
    );
  }, movementX);
  await window.waitForTimeout(60);
}

/**
 * 消耗指针锁定后输入层跳过的前两次 mousemove，避免环视截图的前两个方向为空。
 *
 * @param {Object} window
 * @returns {Promise<void>}
 */
async function primePointerLockMoves(window) {
  await window.evaluate(() => {
    for (let index = 0; index < 2; index += 1) {
      window.dispatchEvent(
        new MouseEvent('mousemove', {
          movementX: 0,
          movementY: 0,
          bubbles: true
        })
      );
    }
  });
  await window.waitForTimeout(40);
}

/**
 * 若对局因指针锁定丢失被自动暂停，则点击“继续”并重新消耗两次跳过事件。
 *
 * @param {Object} window
 * @returns {Promise<boolean>} 是否执行了恢复。
 */
async function resumeIfPaused(window) {
  const state = await readState(window);
  if (state === 'over') {
    return false;
  }
  if (state !== 'paused') {
    return false;
  }
  const resumeVisible = await window.locator('#resume-btn').isVisible();
  if (resumeVisible === false) {
    return false;
  }
  await window.locator('#resume-btn').click();
  const resumed = await waitForState(window, 'playing', 5000);
  assert.equal(resumed.reached, true, '指针锁定丢失后应能点击继续恢复对局');
  await primePointerLockMoves(window);
  return true;
}

/**
 * 依次转动视角并在每个方向截图，覆盖 360°，用于取得能看到人类士兵的对局画面。
 *
 * @param {Object} window
 * @param {number} count
 * @param {string} prefix
 * @returns {Promise<Array<Object>>}
 */
async function captureRotationShots(window, count, prefix) {
  const start = (await readSnapshot(window)).player;
  const shots = [];
  const stepPixels = count > 0 ? Math.round(2856 / count) : 714;
  for (let index = 0; index < count; index += 1) {
    await resumeIfPaused(window);
    await turnByMovement(window, stepPixels);
    const snapshot = await readSnapshot(window);
    const file = path.join(
      SCREENSHOT_DIR,
      prefix + '-' + String(index + 1).padStart(2, '0') + '.png'
    );
    await window.screenshot({ path: file });
    shots.push({
      file,
      yaw: snapshot.player.yaw,
      startYaw: start.yaw,
      enemyAlive: snapshot.enemies.alive,
      state: snapshot.state
    });
  }
  return shots;
}

/**
 * 从菜单打开设置并恢复默认值，保证每次运行不依赖上一次留下的本地设置。
 *
 * @param {Object} window
 * @returns {Promise<void>}
 */
async function resetSettingsToDefaults(window) {
  await window.locator('#menu-settings-btn').click();
  await window.waitForFunction(
    () => window.__DUSTLINE_TEST__.getHud().settingsVisible === true,
    null,
    { timeout: 5000, polling: 50 }
  );
  await window.locator('#settings-reset').click();
  await window.waitForFunction(
    () => {
      const value = window.__DUSTLINE_TEST__.getSettings();
      return (
        value.mouseSensitivity === 1.0 &&
        value.adsSensitivityMultiplier === 0.8 &&
        value.fov === 75 &&
        value.masterVolume === 0.7 &&
        value.quality === 'high'
      );
    },
    null,
    { timeout: 8000, polling: 50 }
  );
  await window.locator('#settings-close').click();
  await window.waitForFunction(
    () => window.__DUSTLINE_TEST__.getHud().settingsVisible === false,
    null,
    { timeout: 5000, polling: 50 }
  );
}

/**
 * 在对局已暂停时点击暂停界面的“设置”并等待面板可见。
 *
 * @param {Object} window
 * @returns {Promise<void>}
 */
async function openSettingsFromPause(window) {
  await window.waitForFunction(
    () => window.__DUSTLINE_TEST__.getState() === 'paused',
    null,
    { timeout: 4000, polling: 50 }
  );
  await window.locator('#pause-settings-btn').click();
  await window.waitForFunction(
    () => window.__DUSTLINE_TEST__.getHud().settingsVisible === true,
    null,
    { timeout: 5000, polling: 50 }
  );
}

/**
 * 关闭设置面板但不恢复对局。
 *
 * @param {Object} window
 * @returns {Promise<void>}
 */
async function closeSettingsOnly(window) {
  await window.locator('#settings-close').click();
  await window.waitForFunction(
    () => window.__DUSTLINE_TEST__.getHud().settingsVisible === false,
    null,
    { timeout: 5000, polling: 50 }
  );
}

test(
  'Electron 冒烟：窗口标题、canvas、装载完成、菜单、O4 只读钩子与设置/性能接口',
  { timeout: 180000 },
  async (t) => {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const session = await launchApp();
    t.after(async () => {
      await session.app.close();
    });

    const info = await session.app.evaluate(({ app }) => {
      return {
        electron: process.versions.electron,
        appVersion: app.getVersion(),
        appPath: app.getAppPath()
      };
    });
    t.diagnostic(
      'Electron ' + info.electron + '，应用版本 ' + info.appVersion +
        '，appPath ' + info.appPath
    );

    const title = await session.window.title();
    t.diagnostic('窗口标题 ' + title);
    assert.equal(title, 'DUSTLINE · 尘埃战线');

    const canvas = session.window.locator('#game');
    assert.equal(await canvas.count(), 1, '页面必须存在 #game canvas');
    assert.equal(await canvas.evaluate((element) => element.tagName), 'CANVAS');

    await waitForReady(session.window);

    const loadingHidden = await session.window.evaluate(() => {
      return document.getElementById('loading').classList.contains('hidden');
    });
    assert.equal(loadingHidden, true, '装载遮罩应已隐藏');

    const startVisible = await session.window.locator('#start-btn').isVisible();
    assert.equal(startVisible, true, '开始按钮应可见');

    const hookType = await session.window.evaluate(() => {
      return typeof window.__DUSTLINE_TEST__;
    });
    assert.equal(hookType, 'object', '仅测试模式应暴露只读钩子');

    const state = await readState(session.window);
    const hud = await readHud(session.window);
    assert.equal(state, 'menu');
    assert.equal(hud.menuVisible, true);
    assert.equal(hud.health, 100);
    assert.equal(hud.ammo, 30);
    assert.equal(hud.wave, 1);

    await resetSettingsToDefaults(session.window);

    const settings = await readSettings(session.window);
    assert.equal(settings.mouseSensitivity, 1.0);
    assert.equal(settings.adsSensitivityMultiplier, 0.8);
    assert.equal(settings.fov, 75);
    assert.equal(settings.masterVolume, 0.7);
    assert.equal(settings.quality, 'high');
    t.diagnostic('默认设置 ' + JSON.stringify(settings));

    const performance = await readPerformance(session.window);
    assert.equal(typeof performance.fps, 'number');
    assert.equal(typeof performance.frameCount, 'number');
    assert.equal(typeof performance.enemyCount, 'number');
    assert.equal(performance.quality === 'high' || performance.quality === 'low', true);
    assert.equal(typeof performance.postProcessing, 'boolean');
    t.diagnostic('菜单性能仪表 ' + JSON.stringify(performance));

    const viewport = await session.window.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
      dpr: window.devicePixelRatio
    }));
    t.diagnostic('客户区尺寸 ' + JSON.stringify(viewport));
    assert.equal(viewport.width > 1500, true);
    assert.equal(viewport.height > 800, true);

    const screenshotPath = path.join(SCREENSHOT_DIR, 'e2e-menu.png');
    await session.window.screenshot({ path: screenshotPath });
    t.diagnostic('菜单截图 ' + screenshotPath);

    const pageErrors = session.consoleMessages.filter(
      (message) => message.type === 'pageerror'
    );
    assert.deepEqual(pageErrors, [], '页面不应有未捕获异常');
  }
);

test(
  'Electron 画面取证：进入人类士兵对局并环视四个方向截图',
  { timeout: 180000 },
  async (t) => {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const session = await launchApp();
    t.after(async () => {
      await session.app.close();
    });

    await waitForReady(session.window);
    await resetSettingsToDefaults(session.window);
    await startMatch(session.window);

    const initial = await waitForEnemies(session.window, 2);
    t.diagnostic(
      '取证时敌人 ' + JSON.stringify(initial.enemies) +
        '，类型 ' + JSON.stringify(initial.enemies.types)
    );

    await primePointerLockMoves(session.window);
    const shots = await captureRotationShots(session.window, 4, 'e2e-gameplay');
    t.diagnostic('四方向对局截图 ' + JSON.stringify(shots));
    assert.equal(shots.length, 4);
    assert.equal(
      shots.some((shot) => Math.abs(shot.yaw - shot.startYaw) > 0.5),
      true,
      '环视应转动视角'
    );
    assert.equal(
      shots.some((shot) => shot.state === 'playing'),
      true,
      '至少一张截图应在 playing 状态取得'
    );

    const pageErrors = session.consoleMessages.filter(
      (message) => message.type === 'pageerror'
    );
    assert.deepEqual(pageErrors, [], '画面取证不应有未捕获页面异常');
  }
);

test(
  'Electron 完整流程：人类士兵对局、射击/换弹/ADS、暂停、设置画质、性能采样、死亡与重开',
  { timeout: 420000 },
  async (t) => {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const session = await launchApp();
    t.after(async () => {
      await session.app.close();
    });

    const info = await session.app.evaluate(({ app }) => ({
      electron: process.versions.electron,
      appVersion: app.getVersion()
    }));
    t.diagnostic('Electron ' + info.electron + '，应用版本 ' + info.appVersion);
    t.diagnostic('窗口标题 ' + (await session.window.title()));

    await waitForReady(session.window);
    await resetSettingsToDefaults(session.window);
    await startMatch(session.window);

    const hud = await readHud(session.window);
    assert.equal(hud.state, 'playing');
    assert.equal(hud.menuVisible, false, '开始后主菜单应隐藏');
    assert.equal(hud.health, 100);
    assert.equal(hud.ammo, 30);
    assert.equal(hud.wave, 1);

    const hudHidden = await session.window.evaluate(() => {
      return document.getElementById('hud').classList.contains('hidden');
    });
    assert.equal(hudHidden, false, '对局中 HUD 应可见');

    // 等第一批人类士兵生成后截图。
    let snapshot = await waitForEnemies(session.window, 2);
    t.diagnostic(
      '第一批敌人 ' + JSON.stringify(snapshot.enemies) +
        '，类型 ' + JSON.stringify(snapshot.enemies.types)
    );
    assert.equal(snapshot.enemies.wave, 1);
    assert.equal(
      Object.keys(snapshot.enemies.types).sort().join(','),
      'breacher,heavy,rifleman',
      '敌方状态只应包含人类兵种'
    );
    assert.equal(snapshot.enemies.types.drone, undefined);
    assert.equal(snapshot.enemies.types.brute, undefined);
    assert.equal(snapshot.enemies.types.wraith, undefined);

    const gameplayShot = path.join(SCREENSHOT_DIR, 'e2e-gameplay-initial.png');
    await session.window.screenshot({ path: gameplayShot });
    t.diagnostic('初始对局截图 ' + gameplayShot);

    const pointerLock = await session.window.evaluate(() => {
      const element = document.pointerLockElement;
      return element === null ? null : element.id;
    });
    t.diagnostic('指针锁定元素 ' + String(pointerLock));
    if (pointerLock === null) {
      // 未聚焦的自动化窗口可能被 Chromium 拒绝 pointer lock；真实玩家会点击
      // 画布重新捕获鼠标。记录启动时未锁定，并用真实点击重试。
      const ensured = await ensurePointerLock(session);
      t.diagnostic('启动时未获得指针锁定，画布点击后 ' + JSON.stringify(ensured));
    }

    // WASD 移动：依次按下并比较快照位置。
    let before = (await readSnapshot(session.window)).player;
    await session.window.keyboard.down('w');
    await session.window.waitForTimeout(350);
    await session.window.keyboard.up('w');
    let after = (await readSnapshot(session.window)).player;
    assert.equal(after.z < before.z - 0.5, true, 'W 应向前（-Z）移动');

    before = after;
    await session.window.keyboard.down('s');
    await session.window.waitForTimeout(350);
    await session.window.keyboard.up('s');
    after = (await readSnapshot(session.window)).player;
    assert.equal(after.z > before.z + 0.5, true, 'S 应向后（+Z）移动');

    before = after;
    await session.window.keyboard.down('a');
    await session.window.waitForTimeout(350);
    await session.window.keyboard.up('a');
    after = (await readSnapshot(session.window)).player;
    assert.equal(after.x < before.x - 0.5, true, 'A 应向左（-X）移动');

    before = after;
    await session.window.keyboard.down('d');
    await session.window.waitForTimeout(350);
    await session.window.keyboard.up('d');
    after = (await readSnapshot(session.window)).player;
    assert.equal(after.x > before.x + 0.5, true, 'D 应向右（+X）移动');

    // 射击：指针锁定成功后左键按住应消耗弹药。
    await session.window.mouse.move(800, 450);
    await session.window.mouse.down();
    await session.window.waitForTimeout(500);
    await session.window.mouse.up();
    const afterFire = await readSnapshot(session.window);
    assert.equal(
      afterFire.weapon.ammo < 30,
      true,
      '左键射击应消耗弹药，实际 ' + afterFire.weapon.ammo +
        '；指针锁定元素 ' + String(pointerLock)
    );

    // 换弹：R 后进入 reloading，约 1.5 秒后恢复满弹匣。
    await session.window.keyboard.press('r');
    await session.window.waitForFunction(
      () => window.__DUSTLINE_TEST__.getHud().reloading === true,
      null,
      { timeout: 3000, polling: 50 }
    );
    const reloading = await readHud(session.window);
    assert.equal(reloading.reloading, true, 'HUD 应显示换弹状态');
    await session.window.waitForFunction(
      () => {
        const weapon = window.__DUSTLINE_TEST__.getSnapshot().weapon;
        return weapon.reloading === false && weapon.ammo === weapon.magazineSize;
      },
      null,
      { timeout: 5000, polling: 50 }
    );
    const reloaded = await readSnapshot(session.window);
    assert.equal(reloaded.weapon.ammo, reloaded.weapon.magazineSize);

    // 右键瞄准（O1）：HUD aiming 变为 true，截图后松开恢复 false。
    await session.window.mouse.down({ button: 'right' });
    await session.window.waitForFunction(
      () => window.__DUSTLINE_TEST__.getHud().aiming === true,
      null,
      { timeout: 3000, polling: 50 }
    );
    const aiming = await readHud(session.window);
    assert.equal(aiming.aiming, true);
    await session.window.waitForTimeout(350);
    const adsShot = path.join(SCREENSHOT_DIR, 'e2e-weapon-ads.png');
    await session.window.screenshot({ path: adsShot });
    t.diagnostic('武器/ADS 截图 ' + adsShot);
    await session.window.mouse.up({ button: 'right' });
    await session.window.waitForFunction(
      () => window.__DUSTLINE_TEST__.getHud().aiming === false,
      null,
      { timeout: 3000, polling: 50 }
    );
    const notAiming = await readHud(session.window);
    assert.equal(notAiming.aiming, false);

    // 暂停截图。
    await session.window.keyboard.press('Escape');
    const paused = await waitForState(session.window, 'paused', 4000);
    assert.equal(paused.reached, true, 'ESC 应暂停对局');
    const pausedHud = await readHud(session.window);
    assert.equal(pausedHud.pausedVisible, true);
    const pausedShot = path.join(SCREENSHOT_DIR, 'e2e-pause.png');
    await session.window.screenshot({ path: pausedShot });
    t.diagnostic('暂停截图 ' + pausedShot);

    // 暂停中采样高画质性能：暂停时渲染循环继续执行，敌人保留在场上，
    // 玩家不会继续受伤。这里记录的是暂停画面的真实渲染帧率。
    await waitForEnemies(session.window, 2);
    const highSample = await samplePerformance(session.window, PERFORMANCE_SAMPLE_MS);
    const highState = await readState(session.window);
    t.diagnostic(
      '高画质性能（暂停画面） ' + JSON.stringify({
        state: highState,
        viewport: highSample.viewport,
        dpr: highSample.devicePixelRatio,
        frameDelta: highSample.frameDelta,
        wallSeconds: highSample.wallSeconds,
        measuredFps: highSample.measuredFps,
        final: highSample.final,
        fpsSamples: highSample.samples.map((sample) => sample.fps),
        enemyCounts: highSample.samples.map((sample) => sample.enemyCount)
      })
    );
    assert.equal(highState, 'paused');
    assert.equal(highSample.final.quality, 'high');
    assert.equal(highSample.final.postProcessing, true);
    assert.equal(highSample.final.enemyCount >= 2, true);
    assert.equal(highSample.measuredFps > 0, true);
    assert.equal(highSample.frameDelta > 0, true);

    // 低画质：仍在对局暂停中，从暂停设置切到 low，确认后处理关闭并采样。
    await openSettingsFromPause(session.window);
    await session.window.selectOption('#setting-quality', 'low');
    await session.window.waitForFunction(
      () => window.__DUSTLINE_TEST__.getSettings().quality === 'low',
      null,
      { timeout: 5000, polling: 50 }
    );
    const lowPerfPaused = await readPerformance(session.window);
    assert.equal(lowPerfPaused.quality, 'low');
    assert.equal(lowPerfPaused.postProcessing, false, '低画质应关闭后处理');
    await closeSettingsOnly(session.window);
    const lowSample = await samplePerformance(session.window, PERFORMANCE_SAMPLE_MS);
    const lowState = await readState(session.window);
    t.diagnostic(
      '低画质性能（暂停画面） ' + JSON.stringify({
        state: lowState,
        viewport: lowSample.viewport,
        dpr: lowSample.devicePixelRatio,
        frameDelta: lowSample.frameDelta,
        wallSeconds: lowSample.wallSeconds,
        measuredFps: lowSample.measuredFps,
        final: lowSample.final,
        fpsSamples: lowSample.samples.map((sample) => sample.fps),
        enemyCounts: lowSample.samples.map((sample) => sample.enemyCount)
      })
    );
    assert.equal(lowState, 'paused');
    assert.equal(lowSample.final.quality, 'low');
    assert.equal(lowSample.final.postProcessing, false);
    assert.equal(lowSample.measuredFps > 0, true);

    // 低画质对局截图：短暂继续后截图，再暂停恢复高画质。
    await session.window.locator('#resume-btn').click();
    const lowResumed = await waitForState(session.window, 'playing', 5000);
    assert.equal(lowResumed.reached, true);
    await session.window.waitForTimeout(400);
    const lowShot = path.join(SCREENSHOT_DIR, 'e2e-low-quality.png');
    await session.window.screenshot({ path: lowShot });
    t.diagnostic('低画质对局截图 ' + lowShot);

    // 恢复高画质，随后等待死亡。
    await session.window.keyboard.press('Escape');
    const pausedAgain = await waitForState(session.window, 'paused', 4000);
    assert.equal(pausedAgain.reached, true, 'ESC 应再次暂停对局');
    await openSettingsFromPause(session.window);
    await session.window.selectOption('#setting-quality', 'high');
    await session.window.waitForFunction(
      () => window.__DUSTLINE_TEST__.getSettings().quality === 'high',
      null,
      { timeout: 5000, polling: 50 }
    );
    await closeSettingsOnly(session.window);
    await session.window.locator('#resume-btn').click();
    const resumedForDeath = await waitForState(session.window, 'playing', 5000);
    assert.equal(resumedForDeath.reached, true, '恢复高画质后继续应回到 playing');

    const death = await waitForDeath(
      session.window,
      DEATH_TIMEOUT_MS,
      (message) => t.diagnostic(message)
    );
    t.diagnostic('死亡观察采样 ' + JSON.stringify(death.samples.slice(-5)));
    if (death.reached === false) {
      t.diagnostic(
        '死亡流程未在 ' + DEATH_TIMEOUT_MS / 1000 +
          ' 秒内出现；Electron 端记为本项未验证，规则级证明见集成测试'
      );
      return;
    }

    const gameover = await readHud(session.window);
    assert.equal(gameover.state, 'over');
    assert.equal(gameover.gameoverVisible, true, '死亡后应显示结算界面');
    const gameoverShot = path.join(SCREENSHOT_DIR, 'e2e-gameover.png');
    await session.window.screenshot({ path: gameoverShot });
    t.diagnostic('结算截图 ' + gameoverShot);

    await session.window.locator('#restart-btn').click();
    const afterDeathRestart = await waitForState(session.window, 'playing', 8000);
    assert.equal(afterDeathRestart.reached, true, '结算界面重开应回到 playing');
    const fresh = await readSnapshot(session.window);
    assert.equal(fresh.score, 0);
    assert.equal(fresh.kills, 0);
    assert.equal(fresh.wave, 1);
    assert.equal(fresh.player.health, 100);
    assert.equal(fresh.player.alive, true);
    assert.equal(fresh.weapon.ammo, 30);

    const pageErrors = session.consoleMessages.filter(
      (message) => message.type === 'pageerror'
    );
    assert.deepEqual(pageErrors, [], '完整流程不应有未捕获页面异常');
  }
);

test(
  'Electron ADS 黑镜回归：真实右键瞄准后中心亮度、红点、HIP 恢复与前后截图',
  { timeout: 180000 },
  async (t) => {
    mkdirSync(ADS_FIX_SCREENSHOT_DIR, { recursive: true });

    // 修复前证据来自战斗服务（只读复制，不覆盖来源）。
    assert.equal(
      existsSync(ADS_BEFORE_SOURCE),
      true,
      '缺少修复前 ADS 证据 ' + ADS_BEFORE_SOURCE
    );
    const adsBeforeCopy = path.join(ADS_FIX_SCREENSHOT_DIR, 'ads-before.png');
    copyFileSync(ADS_BEFORE_SOURCE, adsBeforeCopy);
    t.diagnostic('修复前 ADS 截图（复制自战斗服务证据） ' + adsBeforeCopy);

    const session = await launchApp();
    t.after(async () => {
      await session.app.close();
    });

    await waitForReady(session.window);
    await resetSettingsToDefaults(session.window);
    await startMatch(session.window);

    const lock = await ensurePointerLock(session);
    t.diagnostic('ADS 回归指针锁定 ' + JSON.stringify(lock));
    if (lock.locked === false) {
      t.skip(
        'ADS 黑镜回归 NOT RUN：Electron 中无法获得指针锁定（hasFocus=' +
          lock.hasFocus + '）；未伪造通过'
      );
      return;
    }

    const viewport = await session.window.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
      dpr: window.devicePixelRatio
    }));
    t.diagnostic('ADS 回归客户区 ' + JSON.stringify(viewport));

    // 右键 ADS：等待 HUD/武器/准星/ADS 指示器全部进入瞄准状态。
    await session.window.mouse.move(viewport.width / 2, viewport.height / 2);
    await session.window.mouse.down({ button: 'right' });
    await waitForAdsState(session.window);
    // 等待视图模型插值到完整 ADS（transitionRate 约 12/秒）。
    await session.window.waitForTimeout(650);

    const adsHud = await readHud(session.window);
    const adsSnapshot = await readSnapshot(session.window);
    assert.equal(adsHud.aiming, true, 'HUD 应处于 ADS');
    assert.equal(adsSnapshot.weapon.aiming, true, '武器快照应处于 ADS');
    assert.equal(adsSnapshot.state, 'playing', '采样时对局应仍在 playing');
    t.diagnostic(
      'ADS 状态 HUD ' + JSON.stringify({
        aiming: adsHud.aiming,
        ammo: adsHud.ammo,
        state: adsSnapshot.state,
        weaponAiming: adsSnapshot.weapon.aiming
      })
    );

    const adsAfterPath = path.join(ADS_FIX_SCREENSHOT_DIR, 'ads-after.png');
    const adsCenterPath = path.join(
      ADS_FIX_SCREENSHOT_DIR,
      'ads-center-after.png'
    );
    await session.window.screenshot({ path: adsAfterPath });
    const centerX = Math.round(viewport.width / 2);
    const centerY = Math.round(viewport.height / 2);
    const clip = {
      x: Math.max(0, centerX - ADS_CLIP_SIZE / 2),
      y: Math.max(0, centerY - ADS_CLIP_SIZE / 2),
      width: ADS_CLIP_SIZE,
      height: ADS_CLIP_SIZE
    };
    const centerBuffer = await session.window.screenshot({
      path: adsCenterPath,
      clip
    });
    t.diagnostic('ADS 全屏截图 ' + adsAfterPath);
    t.diagnostic(
      'ADS 中心裁剪截图 ' + adsCenterPath + '（' + ADS_CLIP_SIZE + '×' +
        ADS_CLIP_SIZE + ' @ ' + JSON.stringify({ x: clip.x, y: clip.y }) + '）'
    );

    const analysis = await analyzeAdsCenterClip(session.window, centerBuffer);
    t.diagnostic('ADS 中心像素统计 ' + JSON.stringify(analysis));

    assert.ok(
      analysis.width >= ADS_CLIP_SIZE && analysis.height >= ADS_CLIP_SIZE,
      '中心裁剪应至少为 ' + ADS_CLIP_SIZE + '×' + ADS_CLIP_SIZE +
        '，实际 ' + analysis.width + '×' + analysis.height
    );
    assert.ok(
      analysis.averageLuminance > ADS_MIN_LUMINANCE,
      'ADS 中心平均亮度应 > ' + ADS_MIN_LUMINANCE + '/255，实际 ' +
        analysis.averageLuminance.toFixed(2)
    );
    assert.ok(
      analysis.inner40.averageLuminance > ADS_MIN_INNER_LUMINANCE,
      '镜片中心 40×40 平均亮度应 > ' + ADS_MIN_INNER_LUMINANCE + '/255，实际 ' +
        analysis.inner40.averageLuminance.toFixed(2) +
        '（修复前约 53/255，黑镜会在该断言失败）'
    );
    assert.ok(
      analysis.redCount >= 3,
      'ADS 中心应检测到红点像素（R>120 且 R>1.4G、R>1.4B），实际 ' +
        analysis.redCount + ' 像素，maxR ' + analysis.maxR
    );
    assert.ok(
      analysis.maxR >= 150,
      'ADS 中心红点应足够亮，maxR 实际 ' + analysis.maxR
    );
    assert.ok(
      analysis.strongRedCentroid !== null,
      '应能定位高亮红点中心'
    );
    assert.ok(
      Math.abs(analysis.strongRedCentroid.x - analysis.width / 2) <= 45 &&
        Math.abs(analysis.strongRedCentroid.y - analysis.height / 2) <= 45,
      '高亮红点应位于中心附近，实际 ' + JSON.stringify(analysis.strongRedCentroid)
    );
    assert.ok(
      analysis.uniqueColors > 32,
      '中心裁剪应包含场景颜色细节，而不是纯色填充，实际唯一颜色 ' +
        analysis.uniqueColors
    );
    assert.ok(
      analysis.variance > 50,
      '中心裁剪亮度方差应大于 50，实际 ' + analysis.variance.toFixed(2)
    );

    // HIP 回归：松开右键后状态回到腰射，武器仍在画面中。
    await session.window.mouse.up({ button: 'right' });
    await waitForHipState(session.window);
    await session.window.waitForTimeout(650);
    const hipHud = await readHud(session.window);
    const hipSnapshot = await readSnapshot(session.window);
    assert.equal(hipHud.aiming, false, '松开右键后 HUD 应退出 ADS');
    assert.equal(hipSnapshot.weapon.aiming, false, '松开右键后武器应退出 ADS');
    const hipAfterPath = path.join(ADS_FIX_SCREENSHOT_DIR, 'hip-after.png');
    await session.window.screenshot({ path: hipAfterPath });
    t.diagnostic(
      'HIP 恢复截图 ' + hipAfterPath + '，aiming=' + hipHud.aiming
    );

    const pageErrors = session.consoleMessages.filter(
      (message) => message.type === 'pageerror'
    );
    assert.deepEqual(pageErrors, [], 'ADS 回归不应有未捕获页面异常');
  }
);

test(
  'Electron 设置：菜单/暂停面板、灵敏度/FOV/音量/画质、低画质关后处理、跨重启持久化',
  { timeout: 300000 },
  async (t) => {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });

    const first = await launchApp();
    let firstClosed = false;
    try {
      await waitForReady(first.window);
      await resetSettingsToDefaults(first.window);

      // 菜单打开设置。
      await first.window.locator('#menu-settings-btn').click();
      await first.window.waitForFunction(
        () => window.__DUSTLINE_TEST__.getHud().settingsVisible === true,
        null,
        { timeout: 5000, polling: 50 }
      );
      const menuHud = await readHud(first.window);
      assert.equal(menuHud.settingsVisible, true);
      assert.equal(menuHud.menuVisible, true, '从菜单打开设置时菜单仍保留在背景');

      // 通过真实控件修改四项设置。
      await setRangeValue(first.window, '#setting-mouse-sensitivity', 1.4);
      await setRangeValue(first.window, '#setting-ads-sensitivity', 0.9);
      await setRangeValue(first.window, '#setting-fov', 83);
      await setRangeValue(first.window, '#setting-master-volume', 0.55);
      await first.window.selectOption('#setting-quality', 'low');

      await first.window.waitForFunction(
        () => {
          const value = window.__DUSTLINE_TEST__.getSettings();
          return (
            value.mouseSensitivity === 1.4 &&
            value.adsSensitivityMultiplier === 0.9 &&
            value.fov === 83 &&
            value.masterVolume === 0.55 &&
            value.quality === 'low'
          );
        },
        null,
        { timeout: 8000, polling: 50 }
      );
      const applied = await readSettings(first.window);
      assert.equal(applied.fov, 83);
      assert.equal(applied.quality, 'low');
      t.diagnostic('应用后的设置 ' + JSON.stringify(applied));

      const fovDisplay = await readRangeDisplay(
        first.window,
        '#setting-fov',
        '#setting-fov-value'
      );
      assert.equal(fovDisplay.value, '83');
      assert.equal(fovDisplay.output, '83°');

      const performance = await readPerformance(first.window);
      assert.equal(performance.quality, 'low');
      assert.equal(performance.postProcessing, false, '低画质应关闭后处理');

      const stored = await first.window.evaluate(() => {
        return window.localStorage.getItem('dustline.settings.v3');
      });
      assert.equal(typeof stored, 'string');
      const parsed = JSON.parse(stored);
      assert.equal(parsed.fov, 83);
      assert.equal(parsed.quality, 'low');
      assert.equal(parsed.mouseSensitivity, 1.4);
      assert.equal(parsed.masterVolume, 0.55);
      t.diagnostic('localStorage 设置 ' + stored);

      const settingsShot = path.join(SCREENSHOT_DIR, 'e2e-settings.png');
      await first.window.screenshot({ path: settingsShot });
      t.diagnostic('设置面板截图 ' + settingsShot);

      // 关闭设置并开始，再从暂停界面打开设置。
      await first.window.locator('#settings-close').click();
      await first.window.waitForFunction(
        () => window.__DUSTLINE_TEST__.getHud().settingsVisible === false,
        null,
        { timeout: 5000, polling: 50 }
      );
      await startMatch(first.window);
      await first.window.keyboard.press('Escape');
      const pausedForSettings = await waitForState(first.window, 'paused', 4000);
      assert.equal(pausedForSettings.reached, true, 'ESC 应暂停对局');
      await openSettingsFromPause(first.window);
      const pausedHud = await readHud(first.window);
      assert.equal(pausedHud.state, 'paused');
      assert.equal(pausedHud.settingsVisible, true);
      assert.equal(pausedHud.pausedVisible, true);

      // 暂停中把画质改回 high，确认对局仍保持 paused，继续后恢复 playing。
      await first.window.selectOption('#setting-quality', 'high');
      await first.window.waitForFunction(
        () => window.__DUSTLINE_TEST__.getSettings().quality === 'high',
        null,
        { timeout: 5000, polling: 50 }
      );
      const pausedStill = await readHud(first.window);
      assert.equal(pausedStill.state, 'paused', '修改设置不应自动恢复对局');
      await first.window.locator('#settings-close').click();
      await first.window.waitForFunction(
        () => window.__DUSTLINE_TEST__.getHud().settingsVisible === false,
        null,
        { timeout: 5000, polling: 50 }
      );
      await first.window.locator('#resume-btn').click();
      const resumed = await waitForState(first.window, 'playing', 5000);
      assert.equal(resumed.reached, true, '关闭设置后继续应回到 playing');

      const pageErrors = first.consoleMessages.filter(
        (message) => message.type === 'pageerror'
      );
      assert.deepEqual(pageErrors, [], '设置流程不应有未捕获页面异常');
    } finally {
      await first.app.close();
      firstClosed = true;
    }
    assert.equal(firstClosed, true);

    // 第二次启动：同一用户数据目录，验证 localStorage 中的 FOV/画质持久化。
    const second = await launchApp();
    try {
      await waitForReady(second.window);
      const persisted = await readSettings(second.window);
      assert.equal(persisted.fov, 83, 'FOV 应在重启后保留');
      assert.equal(persisted.quality, 'high');
      assert.equal(persisted.mouseSensitivity, 1.4);
      assert.equal(persisted.masterVolume, 0.55);
      t.diagnostic('重启后设置 ' + JSON.stringify(persisted));

      await second.window.locator('#menu-settings-btn').click();
      await second.window.waitForFunction(
        () => window.__DUSTLINE_TEST__.getHud().settingsVisible === true,
        null,
        { timeout: 5000, polling: 50 }
      );
      const persistedDisplay = await readRangeDisplay(
        second.window,
        '#setting-fov',
        '#setting-fov-value'
      );
      assert.equal(persistedDisplay.value, '83');
      assert.equal(persistedDisplay.output, '83°');

      // 恢复默认，避免给后续运行留下测试设置。
      await second.window.locator('#settings-reset').click();
      await second.window.waitForFunction(
        () => {
          const value = window.__DUSTLINE_TEST__.getSettings();
          return (
            value.fov === 75 &&
            value.quality === 'high' &&
            value.mouseSensitivity === 1.0 &&
            value.masterVolume === 0.7
          );
        },
        null,
        { timeout: 8000, polling: 50 }
      );
      const reset = await readSettings(second.window);
      assert.deepEqual(reset, {
        mouseSensitivity: 1.0,
        adsSensitivityMultiplier: 0.8,
        fov: 75,
        masterVolume: 0.7,
        quality: 'high'
      });
      await second.window.locator('#settings-close').click();

      const pageErrors = second.consoleMessages.filter(
        (message) => message.type === 'pageerror'
      );
      assert.deepEqual(pageErrors, [], '重启后的设置流程不应有未捕获页面异常');
    } finally {
      await second.app.close();
    }
  }
);
