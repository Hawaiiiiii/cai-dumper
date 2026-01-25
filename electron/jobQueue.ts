import { BrowserWindow } from 'electron';

export interface Job {
  id: string;
  type: string;
  run: () => Promise<any>;
  cancel?: () => void;
}

export class JobQueue {
  private currentJob: Job | null = null;
  private win: BrowserWindow | null = null;

  setWindow(win: BrowserWindow) {
    this.win = win;
  }

  get isBusy() {
    return !!this.currentJob;
  }

  get currentJobType() {
    return this.currentJob?.type || null;
  }

  async add<T>(type: string, task: () => Promise<T>, cancelFn?: () => void): Promise<T> {
    if (this.currentJob) {
      throw new Error(`System busy with ${this.currentJob.type}. Please wait.`);
    }
    const id = Math.random().toString(36).substring(7);
    this.currentJob = { id, type, run: task, cancel: cancelFn };
    this.notify();

    try {
      const result = await task();
      return result;
    } finally {
      this.currentJob = null;
      this.notify();
    }
  }

  cancelCurrent() {
    if (this.currentJob && this.currentJob.cancel) {
      this.currentJob.cancel();
    }
  }

  notify() {
    if (this.win && !this.win.isDestroyed()) {
      this.win.webContents.send('job-status', {
        busy: !!this.currentJob,
        current: this.currentJob ? { type: this.currentJob.type, id: this.currentJob.id } : null
      });
    }
  }
}