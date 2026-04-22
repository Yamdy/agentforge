import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Effect } from "effect";
import { SQLiteStorage } from "../src";

describe("SQLiteStorage", () => {
  let storage: SQLiteStorage;

  beforeEach(() => {
    storage = new SQLiteStorage({ rootDir: ":memory:" });
  });

  afterEach(() => {
    storage.close();
  });

  it("should write and read data", async () => {
    const key = ["test", "data"];
    const data = { message: "Hello, World!" };

    const writeResult = await Effect.runPromise(storage.write(key, data));
    expect(writeResult).toBeUndefined();

    const readResult = await Effect.runPromise(storage.read<typeof data>(key));
    expect(readResult).toEqual(data);
  });

  it("should update data", async () => {
    const key = ["test", "counter"];
    const initialData = { count: 0 };

    await Effect.runPromise(storage.write(key, initialData));

    const updatedData = await Effect.runPromise(
      storage.update(key, (draft) => {
        draft.count += 1;
      })
    );

    expect(updatedData.count).toBe(1);

    const readResult = await Effect.runPromise(storage.read<typeof initialData>(key));
    expect(readResult.count).toBe(1);
  });

  it("should remove data", async () => {
    const key = ["test", "to-remove"];
    const data = { value: "to be deleted" };

    await Effect.runPromise(storage.write(key, data));
    await Effect.runPromise(storage.remove(key));

    await expect(Effect.runPromise(storage.read(key))).rejects.toThrow();
  });

  it("should list keys", async () => {
    await Effect.runPromise(storage.write(["list", "1"], { id: 1 }));
    await Effect.runPromise(storage.write(["list", "2"], { id: 2 }));
    await Effect.runPromise(storage.write(["other", "3"], { id: 3 }));

    const keys = await Effect.runPromise(storage.list(["list"]));
    expect(keys).toEqual([
      ["list", "1"],
      ["list", "2"]
    ]);
  });
});
