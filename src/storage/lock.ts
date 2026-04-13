const locks = new Map<
  string,
  {
    readers: number;
    writer: boolean;
    waitingReaders: (() => void)[];
    waitingWriters: (() => void)[];
  }
>();

function get(key: string) {
  if (!locks.has(key)) {
    locks.set(key, {
      readers: 0,
      writer: false,
      waitingReaders: [],
      waitingWriters: [],
    });
  }
  return locks.get(key)!;
}

function process(key: string) {
  const lock = locks.get(key);
  if (!lock || lock.writer || lock.readers > 0) return;

  if (lock.waitingWriters.length > 0) {
    const nextWriter = lock.waitingWriters.shift()!;
    nextWriter();
    return;
  }

  while (lock.waitingReaders.length > 0) {
    const nextReader = lock.waitingReaders.shift()!;
    nextReader();
  }

  if (
    lock.readers === 0 &&
    !lock.writer &&
    lock.waitingReaders.length === 0 &&
    lock.waitingWriters.length === 0
  ) {
    locks.delete(key);
  }
}

export const Lock = {
  async read(key: string): Promise<{ [Symbol.dispose](): void }> {
    const lock = get(key);

    return new Promise((resolve) => {
      if (!lock.writer && lock.waitingWriters.length === 0) {
        lock.readers++;
        resolve({
          [Symbol.dispose]: () => {
            lock.readers--;
            process(key);
          },
        });
      } else {
        lock.waitingReaders.push(() => {
          lock.readers++;
          resolve({
            [Symbol.dispose]: () => {
              lock.readers--;
              process(key);
            },
          });
        });
      }
    });
  },

  async write(key: string): Promise<{ [Symbol.dispose](): void }> {
    const lock = get(key);

    return new Promise((resolve) => {
      if (!lock.writer && lock.readers === 0) {
        lock.writer = true;
        resolve({
          [Symbol.dispose]: () => {
            lock.writer = false;
            process(key);
          },
        });
      } else {
        lock.waitingWriters.push(() => {
          lock.writer = true;
          resolve({
            [Symbol.dispose]: () => {
              lock.writer = false;
              process(key);
            },
          });
        });
      }
    });
  },
};
