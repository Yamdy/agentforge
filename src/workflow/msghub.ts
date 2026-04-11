import { Observable, Subject, Subscription } from 'rxjs';
import type { MsgHubConfig, MsgHub as MsgHubType } from './types.js';
import type { Agent } from '../agent/index.js';
import type { Message } from '../types.js';

export class MsgHub implements MsgHubType {
  private _participants: Agent[];
  private _enableAutoBroadcast: boolean;
  private _name?: string;
  private _maxBroadcastDepth: number;
  private messagesSubject: Subject<Message> = new Subject();
  private pendingAnnouncements: Message[] = [];
  public readonly messages$: Observable<Message>;
  private agentResponseSubscriptions: Map<Agent, Subscription> = new Map();
  private broadcastDepth: number = 0;

  constructor(config: MsgHubConfig) {
    this._participants = [...config.participants];
    this._enableAutoBroadcast = config.enableAutoBroadcast ?? true;
    this._name = config.name;
    this._maxBroadcastDepth = config.maxBroadcastDepth ?? 10;

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

    if (this._enableAutoBroadcast) {
      for (const agent of this._participants) {
        this.setupAutoBroadcast(agent);
      }
    }
  }

  get participants(): Agent[] {
    return [...this._participants];
  }

  get name(): string | undefined {
    return this._name;
  }

  add(agent: Agent): void {
    this._participants.push(agent);
    if (this._enableAutoBroadcast) {
      this.setupAutoBroadcast(agent);
    }
  }

  delete(agent: Agent): void {
    const index = this._participants.indexOf(agent);
    if (index !== -1) {
      this._participants.splice(index, 1);
    }
    const sub = this.agentResponseSubscriptions.get(agent);
    if (sub) {
      sub.unsubscribe();
      this.agentResponseSubscriptions.delete(agent);
    }
  }

  broadcast(message: Message): void {
    this.messagesSubject.next(message);

    for (const participant of this._participants) {
      participant.observe(message);
    }
  }

  private setupAutoBroadcast(agent: Agent): void {
    const existing = this.agentResponseSubscriptions.get(agent);
    if (existing) {
      existing.unsubscribe();
    }

    const sub = agent.onResponse().subscribe((response) => {
      if (this.broadcastDepth >= this._maxBroadcastDepth) {
        return;
      }

      this.broadcastDepth++;
      try {
        const broadcastMessage: Message = {
          role: response.role,
          content: response.content,
        };
        this.messagesSubject.next(broadcastMessage);

        for (const participant of this._participants) {
          if (participant !== agent) {
            participant.observe(broadcastMessage);
          }
        }
      } finally {
        this.broadcastDepth--;
      }
    });

    this.agentResponseSubscriptions.set(agent, sub);
  }

  async [Symbol.asyncDispose](): Promise<void> {
    for (const sub of this.agentResponseSubscriptions.values()) {
      sub.unsubscribe();
    }
    this.agentResponseSubscriptions.clear();
    this.messagesSubject.complete();
  }
}
