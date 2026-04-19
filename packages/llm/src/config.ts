import { Effect } from "effect";
import fs from "fs/promises";
import path from "path";
import { LLMConfig, LLMError } from "./types";
import { fileURLToPath } from "url";
import {
  DEFAULT_CONFIG_PATH,
  CONFIG_SECTION_LLM,
  ERROR_MESSAGES,
} from "./constants";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const loadLLMConfigFromJson = (
  configPath?: string
): Effect.Effect<LLMConfig, LLMError> =>
  Effect.tryPromise({
    try: async () => {
      const resolvedPath =
        configPath || path.join(__dirname, DEFAULT_CONFIG_PATH);
      const content = await fs.readFile(resolvedPath, "utf-8");
      const config = JSON.parse(content);

      if (!config[CONFIG_SECTION_LLM]) {
        throw new Error(ERROR_MESSAGES.MISSING_LLM_SECTION);
      }

      const llmConfig = config[CONFIG_SECTION_LLM];

      if (!llmConfig.baseURL) {
        throw new Error(ERROR_MESSAGES.MISSING_BASE_URL);
      }
      if (!llmConfig.apiKey) {
        throw new Error(ERROR_MESSAGES.MISSING_API_KEY);
      }
      if (!llmConfig.model) {
        throw new Error(ERROR_MESSAGES.MISSING_MODEL);
      }

      return llmConfig as LLMConfig;
    },
    catch: (e) =>
      new LLMError(
        `${ERROR_MESSAGES.LOAD_CONFIG_FAILED}: ${
          e instanceof Error ? e.message : String(e)
        }`,
        e
      ),
  });
