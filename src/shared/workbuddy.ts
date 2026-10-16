/** The first integration exercises the documented local-assistant API only. */
export type WorkBuddyConnection = 'unconfigured' | 'unchecked' | 'online' | 'offline' | 'unauthorized' | 'error';
export type WorkBuddyTestPhase = 'checking' | 'sending' | 'waiting' | 'confirmed' | 'unconfirmed' | 'cancelled' | 'failed';
export interface WorkBuddyTest {
  id: string;
  phase: WorkBuddyTestPhase;
  detail: string;
  startedAt: string;
  finishedAt?: string;
  reply?: string;
  /** A lost POST response leaves delivery uncertain. Never automatically resend. */
  delivery: 'not-sent' | 'unknown' | 'accepted';
}
export interface WorkBuddyStatus {
  configured: boolean;
  connection: WorkBuddyConnection;
  detail: string;
  checkedAt?: string;
  test?: WorkBuddyTest;
}
export const workBuddyTestActive = (test?: WorkBuddyTest) => !!test && ['checking', 'sending', 'waiting'].includes(test.phase);
