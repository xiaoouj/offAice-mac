/** Silence, rather than total generation time, bounds conversation-only turns. */
import { DEFAULT_REPLY_IDLE_SECONDS } from '../shared/reply-timeout';
export const ROOM_REPLY_IDLE_MS = DEFAULT_REPLY_IDLE_SECONDS * 1000;

export class RoomReplyTimeoutError extends Error {
  constructor(idleMs = ROOM_REPLY_IDLE_MS) {
    super(`成员连续 ${Math.ceil(idleMs / 1000)} 秒未返回新内容，已停止等待并跳过本轮；请检查网络出口或在设置中延长聊天等待时间，核对后可重新加入。没有自动重发。`);
    this.name = "RoomReplyTimeoutError";
  }
}

export class RoomReplyWatchdog {
  private timer?: NodeJS.Timeout;
  private reject?: (error: Error) => void;
  private waitingForUser = false;
  constructor(
    private idleMs = ROOM_REPLY_IDLE_MS,
    private expired: () => void = () => {},
  ) {}
  progress() {
    if (!this.reject || this.waitingForUser) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.expired();
      this.reject?.(new RoomReplyTimeoutError(this.idleMs));
      this.close();
    }, this.idleMs);
    this.timer.unref();
  }
  waitForUser() {
    this.waitingForUser = true;
    if (this.timer) clearTimeout(this.timer);
  }
  userAnswered() {
    this.waitingForUser = false;
    this.progress();
  }
  async run<T>(action: () => Promise<T>): Promise<T> {
    const timeout = new Promise<never>((_resolve, reject) => {
      this.reject = reject;
    });
    this.progress();
    try {
      return await Promise.race([Promise.resolve().then(action), timeout]);
    } finally {
      this.close();
    }
  }
  private close() {
    if (this.timer) clearTimeout(this.timer);
    this.reject = undefined;
  }
}

/** A broken native cancellation cannot hold the room's execution slot forever. */
export async function boundedRoomCleanup(
  action: () => Promise<unknown>,
  ms: number,
): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      Promise.resolve()
        .then(action)
        .then(
          () => true,
          () => false,
        ),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
