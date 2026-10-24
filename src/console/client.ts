import type {
  WebUiClientBundle,
  WebUiPanel,
  WebUiPanelContext,
} from 'cortico/web/shared/client-panel.ts';
import { mountNapCatLauncher } from './launcher.ts';

type FieldDef = {
  key: string;
  type: string;
  title: string;
  description?: string;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  xHot: boolean;
};
type SchemaResp = { groupId: string; title?: string; properties: FieldDef[]; values: Record<string, unknown> };
type ModuleSpec = { id: string; title: string; desc: string; group: string; prefix: string; topOnly: boolean; status?: string; extra?: string };

/**
 * 「使用教程」链接指向的地址。面板资源路由只放行 manifest 声明的脚本/样式，
 * 教程 HTML 没法从扩展目录伺服，所以这里给一个外部地址；
 * 想换成自己那份，把这个常量改掉重新构建即可。
 */
const TUTORIAL_URL = 'https://github.com/hth768/cortico-world-qq-final/blob/main/docs/guide.md';

// 与 world.ts modulePanels 对应
const MODULES: ModuleSpec[] = [
  { id: 'general', title: '连接与监听', desc: 'OneBot 连接参数与监听名单；连接类改动需重启生效。', group: 'world:qqbot', prefix: '', topOnly: true },
  { id: 'vision', title: '视觉', desc: '辅助视觉（VLM）：接收图片时用视觉模型理解。', group: 'world:qqbot', prefix: 'worlds.qqbot.vision.', topOnly: false },
  { id: 'sticker', title: '表情包', desc: '自动收藏表情包：下载消息里的图片并标注情感/用处。', group: 'world:qqbot', prefix: 'worlds.qqbot.sticker.', topOnly: false },
  { id: 'proactive', title: '主动说话', desc: '后台按状态机向监听会话主动冒泡闲聊。', group: 'world:qqbot', prefix: 'worlds.qqbot.proactive.', topOnly: false },
  { id: 'qzone', title: 'QQ空间', desc: 'QQ 空间动态发布、自动冒泡与评论回复。', group: 'world:qqbot', prefix: 'worlds.qqbot.qzone.', topOnly: false },
  { id: 'group-speak', title: '群聊限速', desc: '限制每个群单位窗口内 bot 发出的消息总量。', group: 'world:qqbot', prefix: 'worlds.qqbot.groupSpeak.', topOnly: false },
  { id: 'anti-loop', title: '防刷/话题结束', desc: '统计连续发言与静默时长，超限自动收尾。', group: 'world:qqbot', prefix: 'worlds.qqbot.antiLoop.', topOnly: false },
  { id: 'routine', title: '作息功能', desc: '睡眠/午休/活跃作息，到点播报。', group: 'world:qqbot', prefix: 'worlds.qqbot.routine.', topOnly: false },
  { id: 'reminder', title: '到点提醒', desc: '定时提醒到点自动发到对应会话。', group: 'world:qqbot', prefix: 'worlds.qqbot.reminder.', topOnly: false },
  { id: 'admin', title: '群管理员', desc: '撤回/@全体/通知/审核进群/头衔/禁言/踢人。', group: 'world:qqbot', prefix: 'worlds.qqbot.admin.', topOnly: false },
  { id: 'voice', title: '语音收发', desc: '对方说话转文字、AI 回复转语音。可整体开关。', group: 'world:qqbot-voice', prefix: '', topOnly: false, status: 'getVoiceState' },
  { id: 'asr', title: '语音模型', desc: 'ASR 引擎与模型下载：sherpa-onnx int8 量化版约 228MB。', group: 'world:qqbot-asr', prefix: '', topOnly: false, status: 'getAsrModelState', extra: 'asr' },
];

function isLongText(key: string, def: FieldDef): boolean {
  if (def.type !== 'string') return false;
  const k = key.toLowerCase();
  if (/prompt|greeting|farewell|notice|描述|systemprompt|voicedesc|voicedesign|extra|system/.test(k)) return true;
  if (def.description && def.description.length > 90) return true;
  return false;
}

function fmtVal(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'boolean') return v ? '开' : '关';
  if (Array.isArray(v)) return v.length ? v.join(' / ') : '（空）';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function statusText(st: Record<string, unknown>): string {
  return Object.entries(st).map(([k, v]) => `${k}: ${fmtVal(v)}`).join('\n');
}

function loadSchema(ctx: WebUiPanelContext, m: ModuleSpec): Promise<SchemaResp | null> {
  return ctx.invoke<SchemaResp>('config', [m.group, m.prefix, m.topOnly]).catch(() => null);
}

function renderField(ctx: WebUiPanelContext, def: FieldDef, value: unknown, commit: (v: unknown) => void): HTMLElement {
  const ui = ctx.ui;
  const wrap = document.createElement('div');
  wrap.style.margin = '10px 0';
  const lab = document.createElement('div');
  lab.style.fontWeight = '600';
  lab.style.marginBottom = '3px';
  lab.textContent = def.title + (def.xHot ? '' : '（改完需重启生效）');
  wrap.appendChild(lab);

  let control: HTMLElement;
  if (def.type === 'boolean') {
    control = ui.checkbox('', { checked: !!value, onChange: (v: boolean) => commit(v) }).el;
  } else if (def.enum && def.enum.length) {
    const v = def.enum.includes(String(value)) ? String(value) : def.enum[0];
    control = ui.select({
      value: v,
      options: def.enum.map((e: string) => ({ value: e, label: e })),
      onChange: (v: string) => commit(v),
    });
  } else if (def.type === 'integer' || def.type === 'number') {
    const num = (v: string): unknown => (def.type === 'integer' ? parseInt(v || '0', 10) : parseFloat(v || '0'));
    control = ui.input({
      value: value == null ? '' : String(value),
      type: 'number',
      onChange: (v: string) => commit(num(v)),
      onCommit: (v: string) => commit(num(v)),
    });
  } else if (isLongText(def.key, def)) {
    // textarea 的裸 Enter 是换行，框架只在 Ctrl/⌘+Enter 时才触发 onCommit。
    control = ui.textarea({
      value: value == null ? '' : String(value),
      rows: 4,
      onChange: (v: string) => commit(v),
      onCommit: (v: string) => commit(v),
    });
  } else if (/secret|key/i.test(def.key) || /key|密钥|token/i.test(def.title)) {
    control = ui.input({
      value: value == null ? '' : String(value),
      type: 'password',
      onChange: (v: string) => commit(v),
      onCommit: (v: string) => commit(v),
    });
  } else {
    control = ui.input({
      value: value == null ? '' : String(value),
      onChange: (v: string) => commit(v),
      onCommit: (v: string) => commit(v),
    });
  }
  wrap.appendChild(control);

  if (def.description) {
    const h = document.createElement('div');
    h.style.fontSize = '11px';
    h.style.opacity = '0.6';
    h.style.marginTop = '3px';
    h.style.lineHeight = '1.4';
    h.textContent = def.description;
    wrap.appendChild(h);
  }
  return wrap;
}

function makePanel(m: ModuleSpec): WebUiPanel {
  return {
    mount(ctx: WebUiPanelContext) {
      const ui = ctx.ui;
      const toast = (msg: string) => { try { ui.toast(msg); } catch { /* noop */ } };

      let debounceTimer: ReturnType<typeof setTimeout> | null = null;
      const debounceCommit = (fn: () => void) => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(fn, 350);
      };
      const commit = (fn: () => void) => debounceCommit(fn);

      const sheet = ui.sheet({ title: m.title, desc: m.desc });
      const formWrap = document.createElement('div');

      const renderForm = (s: SchemaResp) => {
        formWrap.replaceChildren();
        if (!s.properties.length) {
          const empty = document.createElement('div');
          empty.style.opacity = '0.6';
          empty.textContent = '该模块暂无可配置项。';
          formWrap.appendChild(empty);
          return;
        }
        const head = document.createElement('div');
        head.style.fontWeight = '700';
        head.style.margin = '4px 0 8px';
        head.textContent = '配置项';
        formWrap.appendChild(head);
        const reload = () => { void loadSchema(ctx, m).then((s2) => { if (s2) renderForm(s2); }); };
        for (const def of s.properties) {
          formWrap.appendChild(renderField(ctx, def, s.values[def.key], (v) => {
            void ctx.setConfig(m.group, { [def.key]: v })
              .then(() => toast('已保存：' + def.key.split('.').pop()))
              .catch((e: unknown) => toast('保存失败：' + (e instanceof Error ? e.message : String(e))))
              .finally(reload);
          }));
        }
      };

      // 运行时状态（可选）
      if (m.status) {
        const statusBox = document.createElement('div');
        statusBox.style.whiteSpace = 'pre-wrap';
        statusBox.style.fontFamily = 'ui-monospace, monospace';
        statusBox.style.fontSize = '12px';
        statusBox.style.background = 'rgba(127,127,127,0.12)';
        statusBox.style.borderRadius = '6px';
        statusBox.style.padding = '8px 10px';
        statusBox.style.marginBottom = '10px';
        const refresh = ui.button('刷新状态', {
          onClick: () => {
            void ctx.invoke(m.status as string, []).then(
              (st) => { statusBox.textContent = statusText(st as Record<string, unknown>); },
              (e: unknown) => { statusBox.textContent = '状态读取失败：' + (e instanceof Error ? e.message : String(e)); },
            );
          },
        });
        sheet.body.appendChild(refresh);
        sheet.body.appendChild(statusBox);
        void ctx.invoke(m.status, []).then(
          (st) => { statusBox.textContent = statusText(st as Record<string, unknown>); },
          () => { statusBox.textContent = '状态读取失败'; },
        );
      }

      // 连接与监听：顶部放「使用教程」链接 + 「重启连接」按钮。
      // 连接类配置改了之后点一下重启即可生效，不必整进程重启。
      if (m.id === 'general') {
        mountNapCatLauncher(ctx, sheet.body);
        const bar = ui.rowbar();

        const link = document.createElement('a');
        link.href = TUTORIAL_URL;
        link.target = '_blank';
        link.rel = 'noreferrer noopener';
        link.textContent = '📘 使用教程';
        link.style.fontSize = '13px';
        link.style.textDecoration = 'none';
        link.style.color = 'var(--accent, #16a34a)';
        link.title = '新窗口打开接入教程';
        bar.appendChild(link);

        const restart = ui.button('重启连接', {
          size: 'sm',
          title: '按当前配置重建 OneBot 连接（改完连接参数点一下即可生效）',
          onClick: () => {
            restart.disabled = true;
            restart.textContent = '重启中…';
            void ctx.invoke('restartConnection', []).then(
              (r) => {
                const res = r as { ok?: boolean; message?: string; target?: string } | undefined;
                const msg = res?.message ?? (res?.ok ? '已重启连接。' : '重启失败。');
                toast(msg);
                if (res?.target) restart.textContent = `已重启 · ${res.target}`;
              },
              (e: unknown) => { toast('重启失败：' + (e instanceof Error ? e.message : String(e))); },
            ).finally(() => {
              restart.disabled = false;
              setTimeout(() => { restart.textContent = '重启连接'; }, 4000);
            });
          },
        });
        bar.appendChild(restart);

        // 反向连接会自动生成鉴权 Token（持久化到 dataDir/reverse-token.txt，跨重启不变）。
// 用户必须把它复制到协议端「设置反向客户端」的鉴权 Token 并保存，否则连不上。
// 这里把三步流程直接列出来，避免用户漏掉「保存」这一步。
        if (m.id === 'general') {
          void ctx.invoke('getReverseToken', []).then((r) => {
            const t = typeof r === 'string' ? r.trim() : '';
            if (!t) return;
            const box = document.createElement('div');
            box.style.cssText =
              'margin-top:10px;padding:10px 12px;border-radius:8px;font-size:12px;line-height:1.7;' +
              'border:1px solid rgba(220,38,38,.35);background:rgba(220,38,38,.06)';
            const title = document.createElement('div');
            title.style.cssText = 'font-weight:600;margin-bottom:2px';
            title.textContent = '反向连接还需要一步：把下面这串 Token 交给协议端';
            const code = document.createElement('div');
            code.className = 'mono';
            code.style.cssText = 'word-break:break-all;padding:4px 6px;margin:4px 0;border-radius:4px;background:rgba(0,0,0,.06)';
            code.textContent = t;
            const steps = document.createElement('ol');
            steps.style.cssText = 'margin:4px 0 0 18px;padding:0';
            for (const s of [
              '在协议端（NapCat / SnowLuma）里打开这个 Bot 的「设置反向客户端」',
              '把上面这串粘进「鉴权 Token」输入框',
              '点「保存连接」——别忘了这一步，不保存不会生效',
            ]) {
              const li = document.createElement('li');
              li.textContent = s;
              steps.appendChild(li);
            }
            const foot = document.createElement('div');
            foot.style.cssText = 'margin-top:4px;opacity:.75';
            foot.textContent = 'Token 自动生成并保存在 dataDir/reverse-token.txt，重启不会变；漏填或不保存都会连不上。';
            box.append(title, code, steps, foot);
            bar.parentElement?.insertBefore(box, bar.nextSibling);
          }, () => { /* 取不到就不提示，不影响其它功能 */ });
        }
        sheet.body.appendChild(bar);

        const tip = document.createElement('div');
        tip.style.fontSize = '12px';
        tip.style.opacity = '0.7';
        tip.style.margin = '0 0 10px';
        tip.innerHTML =
          '默认是<b>反向连接</b>：桌宠开监听、协议端（NapCat / SnowLuma）主动连入。' +
          '<b>Token 必填</b>——桌宠会自动生成一串，把它填进协议端「设置反向客户端」的鉴权 Token 并保存。' +
          '只有改成「正向连接」时才改填协议端<b>正向 WS 服务器</b>那个 Token。';
        sheet.body.appendChild(tip);
      }

      // ASR 下载按钮（额外）
      if (m.extra === 'asr') {
        const dl = ui.button('下载/校验 ASR 模型', {
          onClick: () => {
            dl.textContent = '下载中…';
            void ctx.invoke('downloadAsrModel', []).then(
              (r) => { toast(JSON.stringify(r)); },
              (e: unknown) => { toast('下载失败：' + (e instanceof Error ? e.message : String(e))); },
            ).finally(() => { dl.textContent = '下载/校验 ASR 模型'; });
          },
        });
        sheet.body.appendChild(dl);
      }

      sheet.body.appendChild(formWrap);
      ctx.root.appendChild(sheet.el);

      void loadSchema(ctx, m).then((schema) => {
        if (!schema) {
          formWrap.replaceChildren();
          formWrap.textContent = '配置读取失败（请确认 Cortico 已整进程重启并刷新页面）。';
        } else {
          renderForm(schema);
        }
      });
    },
  };
}

function sectionEl(title: string, items: string[]): HTMLElement {
  const wrap = document.createElement('div');
  const h = document.createElement('div');
  h.style.fontWeight = '600';
  h.style.margin = '8px 0 4px';
  h.textContent = title + (items.length ? ` (${items.length})` : '');
  wrap.appendChild(h);
  if (!items.length) {
    const p = document.createElement('div');
    p.style.opacity = '0.5';
    p.textContent = '（空）';
    wrap.appendChild(p);
  }
  for (const it of items) {
    const d = document.createElement('div');
    d.style.padding = '2px 0';
    d.style.fontSize = '13px';
    d.textContent = it;
    wrap.appendChild(d);
  }
  return wrap;
}

// 「监听名单」：服务端 getRoster 返回 groups/privates/convs。群号/私聊 QQ 号可直接在页面编辑。
// 写入方式与「配置」面板的表单字段完全一致：**失焦即存、Enter（textarea 为 Ctrl/⌘+Enter）提交**，
// 每次只提交自己那一个字段；保存成功后**不重建表单**，以免把用户刚输入的格式改写成
// `toIds().join(' ')`（如 `111,222` → `111 222`）而让人误以为没保存生效。
type RosterData = { selfId?: number | null; mode?: string; groups?: number[]; privates?: number[]; convs?: Array<{ address: string; label?: string; kind?: string; active?: boolean; members?: number }> };

/** 监听名单两项对应的配置键（与 config.ts 里 world:qqbot 组的 property key 一致）。 */
const ROSTER_KEYS = {
  groups: 'worlds.qqbot.groups',
  privates: 'worlds.qqbot.privates',
} as const;
const ROSTER_LABELS = { groups: '监听群', privates: '监听私聊' } as const;

const rosterPanel: WebUiPanel = {
  mount(ctx: WebUiPanelContext) {
    const ui = ctx.ui;
    const sheet = ui.sheet({ title: '监听名单', desc: '当前监听的群与私聊；下方可直接编辑，保存即时生效（无需重启）。' });
    const status = ui.msgline('加载监听名单…');
    sheet.body.appendChild(status);
    const formHost = document.createElement('div');
    sheet.body.appendChild(formHost);
    ctx.root.appendChild(sheet.el);

    const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

    const build = (data: RosterData) => {
      formHost.replaceChildren();
      const groupsVal = (data.groups || []).join(' ');
      const privatesVal = (data.privates || []).join(' ');

      const info = document.createElement('div');
      info.style.fontSize = '12px';
      info.style.opacity = '0.7';
      info.style.marginBottom = '8px';
      info.textContent = `selfId: ${data.selfId ?? '—'}  mode: ${data.mode ?? '—'}  群数: ${(data.groups || []).length}  私聊数: ${(data.privates || []).length}`;

      /** 保存单个字段：与配置栏 renderField 的 commit 走同一条路（POST /api/config）。 */
      const saveField = async (which: keyof typeof ROSTER_KEYS, raw: string) => {
        status.textContent = `正在保存${ROSTER_LABELS[which]}…`;
        try {
          await ctx.setConfig('world:qqbot', { [ROSTER_KEYS[which]]: raw.trim() });
          status.textContent = `${ROSTER_LABELS[which]}已保存 ✓ 即时生效（无需重启）`;
        } catch (e) {
          status.textContent = `${ROSTER_LABELS[which]}保存失败：${errText(e)}`;
          status.classList.add('bad');
          return;
        }
        status.classList.remove('bad');
        // 只刷新顶部计数，不重建输入框（保留用户输入的原始格式与光标位置）。
        try {
          const r = (await ctx.invoke('getRoster')) as RosterData;
          info.textContent = `selfId: ${r.selfId ?? '—'}  mode: ${r.mode ?? '—'}  群数: ${(r.groups || []).length}  私聊数: ${(r.privates || []).length}`;
        } catch { /* 计数刷新失败不影响已保存的事实 */ }
      };

      const commitGroups = (v: string) => { void saveField('groups', v); };
      const commitPrivates = (v: string) => { void saveField('privates', v); };

      const groupsInput = ui.textarea({
        value: groupsVal,
        rows: 3,
        placeholder: '监听的群号，用空格或逗号分隔；留空=全部群',
        onChange: commitGroups,
        onCommit: commitGroups,
      });
      const privatesInput = ui.textarea({
        value: privatesVal,
        rows: 3,
        placeholder: '监听的私聊 QQ 号，用空格或逗号分隔；留空=不监听私聊',
        onChange: commitPrivates,
        onCommit: commitPrivates,
      });

      const groupWrap = document.createElement('div');
      groupWrap.style.margin = '10px 0';
      const gl = document.createElement('div');
      gl.style.fontWeight = '600';
      gl.style.marginBottom = '3px';
      gl.textContent = '监听群（空格/逗号分隔）';
      groupWrap.append(gl, groupsInput);

      const privWrap = document.createElement('div');
      privWrap.style.margin = '10px 0';
      const pl = document.createElement('div');
      pl.style.fontWeight = '600';
      pl.style.marginBottom = '3px';
      pl.textContent = '监听私聊（空格/逗号分隔）';
      privWrap.append(pl, privatesInput);

      // 两个框各自失焦/Enter 即存；这个按钮只是「一次提交两项」的兜底，不是唯一入口。
      const saveAll = ui.button('保存两个名单', {
        onClick: () => {
          status.textContent = '正在保存…';
          void ctx.setConfig('world:qqbot', {
            [ROSTER_KEYS.groups]: groupsInput.value.trim(),
            [ROSTER_KEYS.privates]: privatesInput.value.trim(),
          }).then(
            () => { status.textContent = '监听群与监听私聊已保存 ✓ 即时生效'; status.classList.remove('bad'); },
            (e: unknown) => { status.textContent = '保存失败：' + errText(e); status.classList.add('bad'); },
          );
        },
      });

      formHost.append(info, groupWrap, privWrap, saveAll);
      formHost.appendChild(sectionEl('活跃会话', (data.convs || []).map((c) => `${c.label || c.address} [${c.kind || '?'}]${c.active ? ' •在线' : ''} 成员:${c.members ?? 0}`)));
    };

    const load = () => {
      status.textContent = '加载监听名单…';
      status.classList.remove('bad');
      return ctx.invoke('getRoster').then(
        (r) => { status.textContent = '编辑后失焦或按 Ctrl/⌘+Enter 即自动保存。'; build(r as RosterData); },
        (e: unknown) => { status.textContent = '监听名单读取失败：' + errText(e); status.classList.add('bad'); },
      );
    };

    void load();
  },
};

// 实时事件：走本面板的 stream 推送通道。
const eventsPanel: WebUiPanel = {
  mount(ctx: WebUiPanelContext) {
    const ui = ctx.ui;
    const sheet = ui.sheet({ title: '实时事件', desc: 'QQ 消息与通知的实时流（离线也能看已存储的）。' });
    const status = document.createElement('div');
    status.style.fontSize = '11px';
    status.style.opacity = '0.6';
    status.style.marginBottom = '6px';
    status.textContent = '连接中…';
    const list = document.createElement('div');
    list.style.maxHeight = 'calc(100vh - 320px)';
    list.style.overflowY = 'auto';
    sheet.body.append(status, list);
    ctx.root.appendChild(sheet.el);
    const handle = ctx.stream({
      open: () => { status.textContent = '● 已连接'; },
      close: (willRetry: boolean) => { status.textContent = willRetry ? '○ 已断开，重连中…' : '○ 已断开'; },
      message: (text: string) => {
        let e: { ts?: string; type?: string; text?: string } = {};
        try { e = JSON.parse(text); } catch { e = { text }; }
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.gap = '6px';
        row.style.padding = '3px 0';
        row.style.borderBottom = '1px solid rgba(127,127,127,0.12)';
        row.style.fontSize = '12px';
        const t = document.createElement('span');
        t.style.opacity = '0.5';
        t.style.flex = '0 0 auto';
        t.textContent = (e.ts || '').slice(11, 19);
        const ty = document.createElement('span');
        ty.style.flex = '0 0 auto';
        ty.style.opacity = '0.7';
        ty.textContent = e.type || '';
        const tx = document.createElement('span');
        tx.style.flex = '1';
        tx.textContent = e.text || '';
        row.append(t, ty, tx);
        list.appendChild(row);
        while (list.childElementCount > 300) list.removeChild(list.firstChild as Node);
        list.scrollTop = list.scrollHeight;
      },
    });
    return handle;
  },
};

const panels: Record<string, WebUiPanel> = {};
for (const m of MODULES) panels[m.id] = makePanel(m);
panels['roster'] = rosterPanel;
panels['events'] = eventsPanel;

const bundle: WebUiClientBundle = { panels };
export default bundle;
