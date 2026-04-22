import { Effect } from "effect";
import type { Tool, RegistryError, ToolCategory } from "./types";

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): Effect.Effect<void, RegistryError, never> {
    return Effect.sync(() => {
      this.tools.set(tool.name, tool);
    });
  }

  unregister(name: string): Effect.Effect<void, RegistryError, never> {
    return Effect.sync(() => {
      this.tools.delete(name);
    });
  }

  registerBatch(tools: Tool[]): Effect.Effect<void, RegistryError, never> {
    return Effect.forEach(tools, (tool) => this.register(tool), {
      concurrency: "unbounded",
    }).pipe(Effect.map(() => void 0));
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  getAll(): Tool[] {
    return Array.from(this.tools.values());
  }

  getByCategory(category: ToolCategory): Tool[] {
    return this.getAll().filter((tool) => tool.category === category);
  }

  search(query: string): Tool[] {
    const kw = query.toLowerCase();
    return this.getAll().filter(
      (tool) =>
        tool.name.toLowerCase().includes(kw) ||
        tool.description.toLowerCase().includes(kw)
    );
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  size(): number {
    return this.tools.size;
  }

  clear(): void {
    this.tools.clear();
  }
}
