import { Observable, Subject } from 'rxjs';
import type { MsgHubConfig, MsgHub as MsgHubType } from './types.js';
import type { Agent } from '../agent/index.js';
import type { Message } from '../types.js';

export class MsgHub implements MsgHubType {
  private _participants: Agent[];
  private messagesSubject: Subject<Message> = new Subject();
  private pendingAnnouncements: Message[] = [];
  public readonly messages$: Observable<Message>;

  constructor(config: MsgHubConfig) {
    this._participants = [...config.participants];

    if (config.announcement) {
      const announcements = Array.isArray(config.announcement)
        ? config.announcement
        : [config.announcement];
      this.pendingAnnouncements = [...announcements];
    }

    const pending = this.pendingAnnouncements;
    this.pendingAnnouncements = [];

    this.messages$ = new Observable((subscriber) => {
      for (const msg of pending) {
        subscriber.next(msg);
      }
      this.messagesSubject.subscribe(subscriber);
    });
  }

  get participants(): Agent[] {
    return [...this._participants];
  }

  add(agent: Agent): void {
    this._participants.push(agent);
  }

  delete(agent: Agent): void {
    const index = this._participants.indexOf(agent);
    if (index !== -1) {
      this._participants.splice(index, 1);
    }
  }

  broadcast(message: Message): void {
    this.messagesSubject.next(message);
  }

  async [Symbol.asyncDispose](): Promise<void> {
    this.messagesSubject.complete();
  }
}
