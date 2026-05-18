import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  InMemorySyncEventStore,
  JsonlSyncEventStore,
  type SyncEvent,
  type SyncEventStore,
  VersionMismatchError,
} from '../src/sync-event.js';

// ---------------------------------------------------------------------------
// Helper: simulate a projector that replays events to build aggregate state
// ---------------------------------------------------------------------------
interface AccountState {
  balance: number;
  version: number;
}

type AccountEvent =
  | { type: 'DEPOSIT'; amount: number }
  | { type: 'WITHDRAW'; amount: number };

function projectAccount(
  state: AccountState,
  event: SyncEvent<AccountEvent>,
): AccountState {
  switch (event.payload.type) {
    case 'DEPOSIT':
      return { ...state, balance: state.balance + event.payload.amount, version: event.version };
    case 'WITHDRAW':
      return { ...state, balance: state.balance - event.payload.amount, version: event.version };
    default:
      return state;
  }
}

async function rebuildAccount(
  store: SyncEventStore<AccountEvent>,
  aggregateId: string,
): Promise<AccountState> {
  let state: AccountState = { balance: 0, version: 0 };
  for await (const event of store.replay(aggregateId)) {
    state = projectAccount(state, event);
  }
  return state;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('SyncEvent', () => {
  describe('InMemorySyncEventStore', () => {
    let store: InMemorySyncEventStore<AccountEvent>;

    beforeEach(() => {
      store = new InMemorySyncEventStore();
    });

    it('append returns an event with all required fields', async () => {
      const event = await store.append('acct-1', 'DEPOSIT', { type: 'DEPOSIT', amount: 100 });

      expect(event).toHaveProperty('version', 1);
      expect(event).toHaveProperty('aggregateId', 'acct-1');
      expect(event).toHaveProperty('seq');
      expect(event).toHaveProperty('timestamp');
      expect(event).toHaveProperty('type', 'DEPOSIT');
      expect(event).toHaveProperty('payload');
      expect(event.payload).toEqual({ type: 'DEPOSIT', amount: 100 });
    });

    it('sequence numbers are monotonic and gap-free per aggregate', async () => {
      await store.append('acct-1', 'DEPOSIT', { type: 'DEPOSIT', amount: 10 });
      await store.append('acct-1', 'DEPOSIT', { type: 'DEPOSIT', amount: 20 });
      await store.append('acct-1', 'WITHDRAW', { type: 'WITHDRAW', amount: 5 });

      const e2 = await store.append('acct-1', 'DEPOSIT', { type: 'DEPOSIT', amount: 30 });

      expect(e2.seq).toBe(4); // 1, 2, 3, 4 — no gaps
    });

    it('replay restores aggregate state from events', async () => {
      await store.append('acct-1', 'DEPOSIT', { type: 'DEPOSIT', amount: 100 });
      await store.append('acct-1', 'DEPOSIT', { type: 'DEPOSIT', amount: 50 });
      await store.append('acct-1', 'WITHDRAW', { type: 'WITHDRAW', amount: 30 });

      const state = await rebuildAccount(store, 'acct-1');
      expect(state.balance).toBe(120); // 100 + 50 - 30
    });

    it('replay from specific sequence number (partial replay)', async () => {
      await store.append('acct-1', 'DEPOSIT', { type: 'DEPOSIT', amount: 100 });
      await store.append('acct-1', 'DEPOSIT', { type: 'DEPOSIT', amount: 50 });
      await store.append('acct-1', 'WITHDRAW', { type: 'WITHDRAW', amount: 30 });

      // Replay from seq 2 onward
      const events: Array<SyncEvent<AccountEvent>> = [];
      for await (const e of store.replay('acct-1', 2)) {
        events.push(e);
      }
      expect(events).toHaveLength(2);
      expect(events[0].seq).toBe(2);
      expect(events[1].seq).toBe(3);
    });

    it('getLastSeq returns correct sequence number', async () => {
      expect(await store.getLastSeq('acct-1')).toBe(0);

      await store.append('acct-1', 'DEPOSIT', { type: 'DEPOSIT', amount: 10 });
      await store.append('acct-1', 'DEPOSIT', { type: 'DEPOSIT', amount: 20 });

      expect(await store.getLastSeq('acct-1')).toBe(2);
    });

    it('cross-aggregate isolation: independent sequence numbers', async () => {
      const e1 = await store.append('acct-1', 'DEPOSIT', { type: 'DEPOSIT', amount: 100 });
      const e2 = await store.append('acct-2', 'DEPOSIT', { type: 'DEPOSIT', amount: 200 });
      const e3 = await store.append('acct-1', 'DEPOSIT', { type: 'DEPOSIT', amount: 50 });

      expect(e1.seq).toBe(1);
      expect(e2.seq).toBe(1); // different aggregate — starts at 1
      expect(e3.seq).toBe(2); // back to acct-1 — advances to 2

      const state1 = await rebuildAccount(store, 'acct-1');
      const state2 = await rebuildAccount(store, 'acct-2');
      expect(state1.balance).toBe(150);
      expect(state2.balance).toBe(200);
    });

    it('version field defaults to 1 and can be incremented on schema change', async () => {
      // First append with default version (1)
      const e1 = await store.append('acct-1', 'DEPOSIT', { type: 'DEPOSIT', amount: 100 }, 2);

      expect(e1.version).toBe(2);

      // Subsequent appends carry the same version unless specified
      const e2 = await store.append('acct-1', 'DEPOSIT', { type: 'DEPOSIT', amount: 50 });
      expect(e2.version).toBe(1);
    });

    it('version mismatch on replay throws VersionMismatchError', async () => {
      await store.append('acct-1', 'DEPOSIT', { type: 'DEPOSIT', amount: 100 }, 1);
      await store.append('acct-1', 'DEPOSIT', { type: 'DEPOSIT', amount: 50 }, 2);

      // Replay with version 1 should fail because event seq 2 has version 2
      const events: Array<SyncEvent<AccountEvent>> = [];
      const promise = (async () => {
        for await (const e of store.replay('acct-1', undefined, 1)) {
          events.push(e);
        }
      })();

      await expect(promise).rejects.toThrow(VersionMismatchError);
      // Should have received seq 1 before failing at seq 2
      expect(events).toHaveLength(1);
      expect(events[0].seq).toBe(1);
    });

    it('replay with matching version succeeds', async () => {
      await store.append('acct-1', 'DEPOSIT', { type: 'DEPOSIT', amount: 100 }, 1);
      await store.append('acct-1', 'DEPOSIT', { type: 'DEPOSIT', amount: 50 }, 1);

      const state = await rebuildAccount(store, 'acct-1');
      expect(state.balance).toBe(150);
      expect(state.version).toBe(1);
    });
  });

  describe('JsonlSyncEventStore', () => {
    let dir: string;
    let store: JsonlSyncEventStore<AccountEvent>;

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'sync-event-test-'));
      store = new JsonlSyncEventStore<AccountEvent>(dir);
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it('append and replay round-trip', async () => {
      await store.append('acct-1', 'DEPOSIT', { type: 'DEPOSIT', amount: 100 });
      await store.append('acct-1', 'DEPOSIT', { type: 'DEPOSIT', amount: 50 });

      const events: Array<SyncEvent<AccountEvent>> = [];
      for await (const e of store.replay('acct-1')) {
        events.push(e);
      }

      expect(events).toHaveLength(2);
      expect(events[0].seq).toBe(1);
      expect(events[0].payload.amount).toBe(100);
      expect(events[1].seq).toBe(2);
      expect(events[1].payload.amount).toBe(50);
    });

    it('replay from specific sequence number', async () => {
      await store.append('acct-1', 'DEPOSIT', { type: 'DEPOSIT', amount: 10 });
      await store.append('acct-1', 'DEPOSIT', { type: 'DEPOSIT', amount: 20 });
      await store.append('acct-1', 'WITHDRAW', { type: 'WITHDRAW', amount: 5 });

      const events: Array<SyncEvent<AccountEvent>> = [];
      for await (const e of store.replay('acct-1', 2)) {
        events.push(e);
      }

      expect(events).toHaveLength(2);
      expect(events[0].seq).toBe(2);
      expect(events[1].seq).toBe(3);
    });

    it('survives process restart (re-reads from disk)', async () => {
      await store.append('acct-1', 'DEPOSIT', { type: 'DEPOSIT', amount: 100 });
      await store.append('acct-1', 'DEPOSIT', { type: 'DEPOSIT', amount: 50 });

      // Simulate restart: new store instance pointing to same directory
      const store2 = new JsonlSyncEventStore<AccountEvent>(dir);
      const state = await rebuildAccount(store2, 'acct-1');

      expect(state.balance).toBe(150);
    });

    it('cross-aggregate isolation persists on disk', async () => {
      await store.append('acct-1', 'DEPOSIT', { type: 'DEPOSIT', amount: 100 });
      await store.append('acct-2', 'DEPOSIT', { type: 'DEPOSIT', amount: 200 });

      const state1 = await rebuildAccount(store, 'acct-1');
      const state2 = await rebuildAccount(store, 'acct-2');
      expect(state1.balance).toBe(100);
      expect(state2.balance).toBe(200);
    });

    it('correctly stores events as JSONL format', async () => {
      await store.append('acct-1', 'DEPOSIT', { type: 'DEPOSIT', amount: 100 }, 2);

      const content = await readFile(join(dir, 'acct-1.jsonl'), 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines).toHaveLength(1);

      const parsed = JSON.parse(lines[0]);
      expect(parsed.version).toBe(2);
      expect(parsed.aggregateId).toBe('acct-1');
      expect(parsed.seq).toBe(1);
      expect(parsed.type).toBe('DEPOSIT');
      expect(parsed.payload.amount).toBe(100);
    });

    it('version mismatch on replay throws VersionMismatchError', async () => {
      // Manually write events with different versions
      const event1: SyncEvent<AccountEvent> = {
        version: 1,
        aggregateId: 'acct-1',
        seq: 1,
        timestamp: Date.now(),
        type: 'DEPOSIT',
        payload: { type: 'DEPOSIT', amount: 100 },
      };
      const event2: SyncEvent<AccountEvent> = {
        version: 2,
        aggregateId: 'acct-1',
        seq: 2,
        timestamp: Date.now(),
        type: 'DEPOSIT',
        payload: { type: 'DEPOSIT', amount: 50 },
      };

      await mkdir(dir, { recursive: true });
      const { writeFile } = await import('node:fs/promises');
      await writeFile(
        join(dir, 'acct-1.jsonl'),
        JSON.stringify(event1) + '\n' + JSON.stringify(event2) + '\n',
        'utf-8',
      );

      const events: Array<SyncEvent<AccountEvent>> = [];
      const promise = (async () => {
        for await (const e of store.replay('acct-1', undefined, 1)) {
          events.push(e);
        }
      })();

      await expect(promise).rejects.toThrow(VersionMismatchError);
      expect(events).toHaveLength(1);
    });
  });

  describe('VersionMismatchError', () => {
    it('has expected properties', () => {
      const err = new VersionMismatchError('acct-1', 1, 2);
      expect(err.message).toContain('acct-1');
      expect(err.message).toContain('1');
      expect(err.message).toContain('2');
      expect(err.name).toBe('VersionMismatchError');
    });

    it('is instanceof Error', () => {
      const err = new VersionMismatchError('acct-1', 1, 2);
      expect(err instanceof Error).toBe(true);
    });
  });
});
