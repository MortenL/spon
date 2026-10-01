import { HandleMap } from './handles';
import { type JobSession, SessionError } from './session';

export const NO_JOB = 'No job open. Use new_job, open_job or use_live_tab.';

/** The one current session and the geometry handles of its latest catalog. */
export class ServerState {
  session: JobSession | null = null;
  readonly handles = new HandleMap();

  requireSession(): JobSession {
    if (!this.session) throw new SessionError(NO_JOB);
    return this.session;
  }

  async ensureCanSwitch(discard = false): Promise<void> {
    if (!this.session || discard) return;
    // a live tab is never discarded by switching, so there is nothing to ask it
    if (this.session.kind === 'live') return;
    const info = await this.session.describe();
    if (info.kind === 'file' && info.dirty) throw new SessionError('The current job has unsaved changes — save_job first, or pass discard: true');
  }

  use(session: JobSession): void {
    this.session = session;
    this.handles.clear();
  }

  /** No current session (the live tab went away). */
  clear(): void {
    this.session = null;
    this.handles.clear();
  }
}
