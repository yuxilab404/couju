/**
 * 站点前缀。页面由服务端注入 <base href="/game/">（本地开发是 "/"），
 * 所有接口、WebSocket、路由地址都从这里拼，站点挂在子路径下也能用。
 */
export const BASE: string = (() => {
  if (typeof document === 'undefined') return '/';
  const p = new URL(document.baseURI).pathname;
  return p.endsWith('/') ? p : p.replace(/[^/]*$/, '');
})();

/** 站内路径（以 / 开头，不含前缀）→ 完整路径 */
export function href(path: string): string {
  return BASE + path.replace(/^\/+/, '');
}

/** 完整路径 → 站内路径（以 / 开头） */
export function appPath(pathname: string): string {
  return pathname.startsWith(BASE) ? '/' + pathname.slice(BASE.length) : pathname;
}
