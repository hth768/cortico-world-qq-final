import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface QuotaState {
  day: string;
  used: number;
  notified: string[];
}

/** 所有 QQ 会话共享的每日额度；独立存盘，删除提醒不会返还额度。 */
export class ReminderQuota {
  private readonly file: string;
  private state: QuotaState = { day: '', used: 0, notified: [] };
  private loadFailed = false;

  constructor(dataDir: string) {
    this.file = dataDir ? join(dataDir, 'reminder-quota.json') : '';
    if (!this.file || !existsSync(this.file)) return;
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as QuotaState;
      if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw.day) || !Number.isSafeInteger(raw.used) || raw.used < 0 ||
          !Array.isArray(raw.notified) || raw.notified.some((address) => typeof address !== 'string')) {
        throw new Error('invalid quota state');
      }
      this.state = raw;
    } catch {
      this.loadFailed = true;
    }
  }

  private current(day: string): QuotaState {
    // 不能读取计数时停止提醒，避免把未知计数当成零后继续调用模型。
    if (this.loadFailed) throw new Error('每日提醒计数存档无法读取，已暂停到点提醒，请检查 reminder-quota.json。');
    return this.state.day === day ? this.state : { day, used: 0, notified: [] };
  }

  private commit(state: QuotaState): void {
    if (this.file) {
      writeFileSync(`${this.file}.tmp`, JSON.stringify(state, null, 2) + '\n', 'utf8');
      renameSync(`${this.file}.tmp`, this.file);
    }
    this.state = state;
  }

  take(day: string, limit: number): boolean {
    const state = this.current(day);
    if (state.used >= limit) return false;
    // 先持久化再唤醒模型，确保重启不能恢复已经用掉的次数。
    this.commit({ ...state, used: state.used + 1 });
    return true;
  }

  wasNotified(day: string, address: string): boolean {
    return this.current(day).notified.includes(address);
  }

  markNotified(day: string, address: string): void {
    const state = this.current(day);
    if (state.notified.includes(address)) return;
    this.commit({ ...state, notified: [...state.notified, address] });
  }
}
