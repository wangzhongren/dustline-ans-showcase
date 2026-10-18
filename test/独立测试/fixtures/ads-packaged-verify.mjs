/**
 * 临时独立验证脚本：用 Playwright 启动打包后的 DUSTLINE.exe，复跑 ADS 中心
 * 亮度/红点采样。只写 fixtures/screenshots-v3-ads-fix/ 下的 packaged-* 截图。
 * 运行后由独立测试角色删除；不进入生产构建。
 */

import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { _electron as electron } from 'playwright-core';

const ROOT = 'D:/work/creategame/shooter3d';
const OUT = path.join(ROOT, 'test/独立测试/fixtures/screenshots-v3-ads-fix');
mkdirSync(OUT, { recursive: true });

const EXE = path.join(ROOT, 'release/win-unpacked/DUSTLINE.exe');
const CLIP_SIZE = 160;

const app = await electron.launch({
  executablePath: EXE,
  env: { ...process.env, DUSTLINE_TEST: '1' },
  timeout: 90000
});

const logs = [];
let window = null;
try {
  window = await app.firstWindow({ timeout: 90000 });
  window.on('console', (message) => {
    logs.push({ type: message.type(), text: message.text() });
  });
  window.on('pageerror', (error) => {
    logs.push({ type: 'pageerror', text: error.message });
  });
  await window.waitForLoadState('domcontentloaded');
  await window.bringToFront();
  await app.evaluate(({ BrowserWindow }) => {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
      windows[0].show();
      windows[0].focus();
    }
  });

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

  const title = await window.title();
  const info = await app.evaluate(({ app: electronApp }) => ({
    electron: process.versions.electron,
    appVersion: electronApp.getVersion(),
    appPath: electronApp.getAppPath()
  }));

  // 通过真实菜单恢复默认设置，避免继承上一次运行留下的 FOV/画质。
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

  await window.locator('#start-btn').click();
  await window.waitForFunction(
    () => window.__DUSTLINE_TEST__.getState() === 'playing',
    null,
    { timeout: 15000 }
  );
  await window.waitForTimeout(500);

  const readLock = () =>
    window.evaluate(() =>
      document.pointerLockElement === null ? null : document.pointerLockElement.id
    );

  let lockElement = await readLock();
  if (lockElement === null) {
    await window.bringToFront();
    await app.evaluate(({ BrowserWindow }) => {
      const windows = BrowserWindow.getAllWindows();
      if (windows.length > 0) {
        windows[0].show();
        windows[0].focus();
      }
    });
    await window.waitForTimeout(300);
    const box = await window.locator('#game').boundingBox();
    const x = box === null ? 800 : box.x + box.width / 2;
    const y = box === null ? 450 : box.y + box.height / 2;
    await window.mouse.click(x, y);
    await window.waitForTimeout(1500);
    lockElement = await readLock();
  }
  const hasFocus = await window.evaluate(() => document.hasFocus());

  console.log(
    'PACKAGED_META ' +
      JSON.stringify({ title, info, lockElement, hasFocus, exe: EXE })
  );

  if (lockElement === null) {
    console.log(
      'PACKAGED_ADS_NOT_RUN ' +
        JSON.stringify({
          reason: 'pointer lock unavailable',
          hasFocus,
          logs
        })
    );
    process.exitCode = 0;
  } else {
    const viewport = await window.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
      dpr: window.devicePixelRatio
    }));

    await window.mouse.move(viewport.width / 2, viewport.height / 2);
    await window.mouse.down({ button: 'right' });
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
    await window.waitForTimeout(650);

    const adsHud = await window.evaluate(() =>
      window.__DUSTLINE_TEST__.getHud()
    );
    const adsWeapon = await window.evaluate(() =>
      window.__DUSTLINE_TEST__.getSnapshot().weapon
    );
    const adsState = await window.evaluate(() =>
      window.__DUSTLINE_TEST__.getState()
    );

    const afterPath = path.join(OUT, 'packaged-ads-after.png');
    const centerPath = path.join(OUT, 'packaged-ads-center-after.png');
    await window.screenshot({ path: afterPath });
    const centerX = Math.round(viewport.width / 2);
    const centerY = Math.round(viewport.height / 2);
    const clip = {
      x: Math.max(0, centerX - CLIP_SIZE / 2),
      y: Math.max(0, centerY - CLIP_SIZE / 2),
      width: CLIP_SIZE,
      height: CLIP_SIZE
    };
    const centerBuffer = await window.screenshot({
      path: centerPath,
      clip
    });

    const analysis = await window.evaluate(async (encoded) => {
      const binary = atob(encoded);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      const bitmap = await createImageBitmap(
        new Blob([bytes], { type: 'image/png' })
      );
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
        const regionAverage =
          regionPixels === 0 ? 0 : regionLuminanceSum / regionPixels;
        return {
          size,
          centerX,
          centerY,
          count,
          maxR: regionMaxR,
          averageLuminance: regionAverage,
          variance: Math.max(
            0,
            regionLuminanceSquareSum / regionPixels -
              regionAverage * regionAverage
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
    }, centerBuffer.toString('base64'));

    await window.mouse.up({ button: 'right' });
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
    await window.waitForTimeout(650);
    const hipHud = await window.evaluate(() =>
      window.__DUSTLINE_TEST__.getHud()
    );
    const hipWeapon = await window.evaluate(() =>
      window.__DUSTLINE_TEST__.getSnapshot().weapon
    );
    const hipPath = path.join(OUT, 'packaged-hip-after.png');
    await window.screenshot({ path: hipPath });

    console.log(
      'PACKAGED_ADS_RESULT ' +
        JSON.stringify({
          title,
          info,
          viewport,
          lockElement,
          hasFocus,
          adsHud: { aiming: adsHud.aiming, ammo: adsHud.ammo },
          adsWeaponAiming: adsWeapon.aiming,
          adsState,
          analysis,
          hip: {
            hudAiming: hipHud.aiming,
            weaponAiming: hipWeapon.aiming,
            path: hipPath
          },
          paths: { afterPath, centerPath },
          pageErrors: logs.filter((entry) => entry.type === 'pageerror'),
          consoleErrors: logs.filter((entry) => entry.type === 'error')
        })
    );
  }
} finally {
  if (window === null) {
    console.log('PACKAGED_ADS_NOT_RUN ' + JSON.stringify({ reason: 'no window', logs }));
  }
  await app.close();
}
