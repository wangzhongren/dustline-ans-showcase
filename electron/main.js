/**
 * DUSTLINE Electron 主进程。
 *
 * 职责只有窗口、安全设置和加载构建产物：
 * - 生产模式通过特权 `app://` 协议提供 `dist/`，让 fetch/XHR、贴图、HDR 与 GLB 正常工作。
 * - 开发模式可由 `VITE_DEV_SERVER_URL` 指向 Vite 服务器。
 * - 不实现任何游戏逻辑；游戏全部在渲染进程的装配入口与各层中。
 * - F11 全屏由渲染进程的界面输入处理，主进程不重复接管。
 */

import path from 'node:path';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { app, BrowserWindow, net, protocol } from 'electron';

/** 窗口设计尺寸与最小尺寸。 */
const WINDOW_WIDTH = 1600;
const WINDOW_HEIGHT = 900;
const MIN_WIDTH = 1280;
const MIN_HEIGHT = 720;
const WINDOW_TITLE = 'DUSTLINE · 尘埃战线';
const WINDOW_BACKGROUND = '#121512';
const APP_SCHEME = 'app';
const APP_HOST = 'dustline';
const APP_ENTRY_URL = 'app://dustline/index.html';

/**
 * 在 app ready 之前注册特权协议。
 *
 * `standard`、`secure` 与 `supportFetchAPI` 是素材加载的关键：素材 Provider 使用
 * `fetch`/Three.js FileLoader 读取 asset-manifest.json、贴图、HDR 与 GLB。
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
]);

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {string | null} */
let devServerOrigin = null;

/**
 * 读取开发服务器地址；没有配置时返回 null。
 *
 * @returns {string | null}
 */
function readDevServerUrl() {
  const value = process.env.VITE_DEV_SERVER_URL;
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }
  return value;
}

/**
 * 计算窗口首次加载的 URL。测试模式通过 `?test=1` 打开 O4 只读钩子。
 *
 * @returns {string}
 */
function buildLoadTarget() {
  const testMode = process.env.DUSTLINE_TEST === '1';
  const devUrl = readDevServerUrl();

  if (devUrl !== null) {
    if (testMode) {
      if (devUrl.includes('?')) {
        return devUrl + '&test=1';
      }
      return devUrl + '?test=1';
    }
    return devUrl;
  }

  if (testMode) {
    return APP_ENTRY_URL + '?test=1';
  }
  return APP_ENTRY_URL;
}

/**
 * 注册 `app://` 文件协议处理器。
 *
 * URL 路径被限制在 `dist/` 内；包含 `..` 或解析后越界的请求返回 403，
 * 缺失文件记录后返回 404。
 *
 * @returns {void}
 */
function registerAppProtocol() {
  protocol.handle(APP_SCHEME, async (request) => {
    try {
      const requestUrl = new URL(request.url);
      if (requestUrl.host !== APP_HOST) {
        console.warn('[electron] 拒绝未知 app:// 主机：' + requestUrl.host);
        return new Response('Not Found', { status: 404 });
      }

      let pathname = decodeURIComponent(requestUrl.pathname);
      if (pathname.length === 0 || pathname === '/') {
        pathname = '/index.html';
      }

      const segments = pathname.split('/');
      if (segments.includes('..')) {
        console.warn('[electron] 拒绝包含 .. 的 app:// 路径：' + pathname);
        return new Response('Forbidden', { status: 403 });
      }

      const distRoot = path.resolve(app.getAppPath(), 'dist');
      const filePath = path.resolve(distRoot, '.' + pathname);
      let distPrefix = distRoot;
      if (!distPrefix.endsWith(path.sep)) {
        distPrefix = distPrefix + path.sep;
      }
      if (filePath !== distRoot && !filePath.startsWith(distPrefix)) {
        console.warn('[electron] 拒绝对 dist/ 之外的访问：' + filePath);
        return new Response('Forbidden', { status: 403 });
      }

      return await net.fetch(pathToFileURL(filePath).toString());
    } catch (error) {
      console.error('[electron] app:// 请求失败：' + request.url, error);
      return new Response('Not Found', { status: 404 });
    }
  });
}

/**
 * 判断导航是否允许。只允许本地 app://dustline 页面与已配置的 Vite 开发服务器。
 *
 * @param {string} targetUrl
 * @returns {boolean}
 */
function isAllowedNavigation(targetUrl) {
  try {
    const target = new URL(targetUrl);
    if (target.protocol === APP_SCHEME + ':' && target.host === APP_HOST) {
      return true;
    }
    if (devServerOrigin !== null && target.origin === devServerOrigin) {
      return true;
    }
    return false;
  } catch (error) {
    console.error('[electron] 无法解析导航 URL：' + targetUrl, error);
    return false;
  }
}

/**
 * 创建主窗口并加载页面。
 *
 * @returns {void}
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    title: WINDOW_TITLE,
    backgroundColor: WINDOW_BACKGROUND,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.once('ready-to-show', () => {
    if (mainWindow !== null) {
      mainWindow.show();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(() => {
    console.warn('[electron] 已拒绝新窗口请求');
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (isAllowedNavigation(targetUrl)) {
      return;
    }
    event.preventDefault();
    console.warn('[electron] 已阻止外部导航：' + targetUrl);
  });

  mainWindow.webContents.on('did-fail-load', (event, code, description, validatedUrl, isMainFrame) => {
    if (isMainFrame) {
      console.error(
        '[electron] 页面加载失败 ' + code + ' ' + description + '：' + validatedUrl
      );
    }
  });

  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error('[electron] 渲染进程退出：' + details.reason, details);
  });

  const loadTarget = buildLoadTarget();
  mainWindow.loadURL(loadTarget).catch((error) => {
    console.error('[electron] loadURL 失败：' + loadTarget, error);
  });
}

/**
 * 启动应用。
 *
 * @returns {Promise<void>}
 */
async function startApplication() {
  const devUrl = readDevServerUrl();
  if (devUrl !== null) {
    try {
      devServerOrigin = new URL(devUrl).origin;
    } catch (error) {
      devServerOrigin = null;
      console.error('[electron] VITE_DEV_SERVER_URL 不是有效 URL，将忽略开发服务器', error);
    }
  }

  registerAppProtocol();

  if (devUrl === null) {
    const entryPath = path.join(app.getAppPath(), 'dist', 'index.html');
    if (!existsSync(entryPath)) {
      throw new Error('未找到构建产物：' + entryPath + '。请先运行 npm run build。');
    }
  }

  createWindow();
}

app.whenReady()
  .then(() => {
    return startApplication();
  })
  .catch((error) => {
    console.error('[electron] 应用启动失败', error);
    app.quit();
  });

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('window-all-closed', () => {
  // 目标平台是 Windows；关闭最后窗口即退出应用。
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
