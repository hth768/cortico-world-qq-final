import type { WebUiPanelContext } from 'cortico/web/shared/client-panel.ts';
import type { NapCatLaunchState } from '../napcat-launcher.ts';

type State = NapCatLaunchState & { mounted: boolean };

export function mountNapCatLauncher(ctx: WebUiPanelContext, parent: HTMLElement): void {
  const box = document.createElement('div');
  box.style.cssText = 'padding:12px;margin-bottom:12px;border:1px solid var(--line,rgba(127,127,127,.25));border-radius:8px';
  const title = document.createElement('div');
  title.textContent = 'QQ 聊天启动';
  title.style.cssText = 'font-weight:600;margin-bottom:8px';
  const status = document.createElement('div');
  status.style.cssText = 'font-size:12px;line-height:1.6;margin-top:8px';
  status.textContent = '正在读取连接状态…';
  const bar = ctx.ui.rowbar();
  let current: State | undefined;
  let busy = false;
  const apply = (state: State) => {
    if (ctx.signal.aborted) return;
    current = state;
    status.textContent = state.message;
    button.disabled = busy || (state.mounted && !state.canStart);
    button.textContent = busy ? '启动中…' : state.state === 'connected' ? 'QQ 已连接' : !state.mounted ? '启动 QQ 聊天' : state.state === 'starting' ? '启动中…' : '启动 QQ 聊天';
  };
  const button = ctx.ui.button('启动 QQ 聊天', {
    size: 'sm',
    onClick: () => {
      if (busy) return;
      busy = true;
      button.disabled = true;
      button.textContent = '启动中…';
      void (async () => {
        // 激活是本机用户的按钮操作，随后才启动协议端；QQ 消息没有此入口。
        const response = await fetch('/api/worlds/activation', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: 'qqbot', enabled: true }), signal: ctx.signal,
        });
        if (!response.ok) throw new Error('启用 QQ 插件失败，请检查插件是否已安装。');
        apply(await ctx.invoke<State>('startNapCat', []));
      })().catch(error => {
        if (!ctx.signal.aborted) apply({
          state: 'error', message: '启动失败：' + (error instanceof Error ? error.message : String(error)),
          canStart: true, mounted: current?.mounted ?? false, loginUrl: login.href,
        });
      }).finally(() => {
        busy = false;
        if (current) apply(current);
        else if (!ctx.signal.aborted) { button.disabled = false; button.textContent = '启动 QQ 聊天'; }
      });
    },
  });
  button.title = '启用插件并启动本机 NapCat；已运行时不会重复启动';
  button.disabled = true;
  const login = document.createElement('a');
  login.href = 'http://127.0.0.1:6099/webui';
  login.target = '_blank';
  login.rel = 'noopener noreferrer';
  login.textContent = 'QQ 登录页';
  login.title = '需要登录或扫码时打开本机 NapCat 管理页';
  bar.append(button, login);
  box.append(title, bar, status);
  parent.appendChild(box);
  let refreshing = false;
  const refresh = () => {
    if (refreshing || busy || ctx.signal.aborted) return;
    refreshing = true;
    void ctx.invoke<State>('getNapCatState', []).then(apply, () => {
      if (!ctx.signal.aborted) status.textContent = '读取连接状态失败，请重新打开本页。';
    }).finally(() => { refreshing = false; });
  };
  refresh();
  ctx.interval(refresh, 5000);
}
