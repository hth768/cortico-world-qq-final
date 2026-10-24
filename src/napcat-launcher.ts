import { spawn, type ChildProcess } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute } from 'node:path';
import { createConnection } from 'node:net';

export type NapCatLaunchState = {
  state: 'connected' | 'waiting' | 'starting' | 'idle' | 'error';
  message: string;
  canStart: boolean;
  loginUrl: string;
};
const LOGIN_URL = 'http://127.0.0.1:6099/webui';

/** 只探测本机管理端口，避免重复启动已由 BAT 打开的 NapCat；不发送登录凭证。 */
function managementListening(): Promise<boolean> {
  return new Promise(resolve => {
    const socket = createConnection({ host: '127.0.0.1', port: 6099 });
    let done = false;
    const finish = (open: boolean) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(open);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(300, () => finish(false));
  });
}

/** 仅本机设置面板调用，不注册为模型工具，不接受命令或参数。 */
export class NapCatLauncher {
  private requestedAt = -Infinity;
  private error = '';
  private inFlight: Promise<NapCatLaunchState> | null = null;

  constructor(
    private readonly path: () => string,
    private readonly connected: () => boolean,
    private readonly deps: {
      spawn: typeof spawn;
      listening: () => Promise<boolean>;
      now: () => number;
      platform: string;
    } = { spawn, listening: managementListening, now: Date.now, platform: process.platform },
  ) {}

  private executable(): string {
    if (this.deps.platform !== 'win32') throw new Error('此启动按钮适用于 Windows NapCat。');
    const path = this.path().trim();
    if (!isAbsolute(path) || /^[/\\]{2}/.test(path) || basename(path).toLowerCase() !== 'napcatwinbootmain.exe') {
      throw new Error('请在下方填写本机 NapCatWinBootMain.exe 的完整路径。');
    }
    try {
      const actual = realpathSync(path);
      if (!statSync(actual).isFile() || basename(actual).toLowerCase() !== 'napcatwinbootmain.exe') throw new Error();
      return actual;
    } catch { throw new Error('找不到 NapCat 启动器，请检查下方路径。'); }
  }

  private state(state: NapCatLaunchState['state'], message: string, canStart = false): NapCatLaunchState {
    return { state, message, canStart, loginUrl: LOGIN_URL };
  }

  async status(): Promise<NapCatLaunchState> {
    if (this.connected()) return this.state('connected', 'QQ 已连接，可以聊天。');
    if (await this.deps.listening()) return this.state('waiting', '本机 NapCat 管理服务已在监听，等待 QQ 登录或连接。需要时打开“QQ 登录页”。');
    if (this.deps.now() - this.requestedAt < 30_000) return this.state('starting', 'NapCat 正在启动，等待 QQ 登录或连接。');
    try { this.executable(); }
    catch (error) { return this.state('error', (error as Error).message); }
    return this.error ? this.state('error', this.error, true) : this.state('idle', 'NapCat 未启动，点击“启动 QQ 聊天”。', true);
  }

  start(): Promise<NapCatLaunchState> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.startOnce().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  private async startOnce(): Promise<NapCatLaunchState> {
    const current = await this.status();
    if (!current.canStart) return current;
    const executable = this.executable();
    const requestedAt = this.deps.now();
    this.requestedAt = requestedAt;
    this.error = '';
    try {
      await new Promise<void>((resolve, reject) => {
        const child: ChildProcess = this.deps.spawn(executable, [], {
          cwd: dirname(executable), shell: false, windowsHide: true, detached: true, stdio: 'ignore',
        });
        child.once('error', error => {
          if (this.requestedAt === requestedAt) {
            this.requestedAt = -Infinity;
            this.error = 'NapCat 启动失败，请检查路径及本机运行权限。';
          }
          reject(error);
        });
        child.once('exit', code => {
          if (code && this.requestedAt === requestedAt) {
            this.requestedAt = -Infinity;
            this.error = `NapCat 启动器退出（代码 ${code}），请在本机检查安装。`;
          }
        });
        child.once('spawn', () => { child.unref(); resolve(); });
      });
      return this.state('starting', '已启动 NapCat，等待 QQ 登录或连接；需要扫码时打开“QQ 登录页”。');
    } catch {
      this.requestedAt = -Infinity;
      this.error ||= 'NapCat 启动失败，请在本机检查安装。';
      return this.state('error', this.error, true);
    }
  }
}
