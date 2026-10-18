/**
 * 临时测试加载器。
 *
 * 根 package.json 目前由界面装配维护为 CommonJS；项目源码按设计使用 ESM。
 * 在 package.json 切换为 "type": "module" 之前，本加载器把项目内 src/ 与 test/ 下的
 * .js 文件按 ES 模块加载，不改变任何生产文件。切换后可直接使用普通 `node --test`。
 */
export async function load(url, context, nextLoad) {
  const isProjectJavascript = url.includes('/src/') || url.includes('/test/');
  const isJavascriptFile = url.endsWith('.js');
  if (isProjectJavascript && isJavascriptFile) {
    return nextLoad(url, { ...context, format: 'module' });
  }
  return nextLoad(url, context);
}
