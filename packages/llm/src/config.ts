import { Effect } from "effect";
import fs from "fs/promises";
import path from "path";
import { LLMConfig, LLMError } from "./types";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const loadLLMConfigFromJson = (
  configPath?: string
): Effect.Effect<LLMConfig, LLMError> =>
  Effect.tryPromise({
    try: async () => {
      const resolvedPath =
        configPath || path.join(__dirname, "../../../config.json");
      const content = await fs.readFile(resolvedPath, "utf-8");
      const config = JSON.parse(content);

      if (!config.llm) {
        throw new Error("Config file missing 'llm' section");
      }

      const llmConfig = config.llm;

      if (!llmConfig.baseURL) {
        throw new Error("LLM baseURL is required");
      }
      if (!llmConfig.apiKey) {
        throw new Error("LLM apiKey is required");
      }
      if (!llmConfig.model) {
        throw new Error("LLM model is required");
      }

      return llmConfig as LLMConfig;
    },
    catch: (e) =>
      new LLMError(
        `Failed to load config: ${e instanceof Error ? e.message : String(e)}`,
        e
      ),
  });
