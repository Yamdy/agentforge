import { Effect } from "effect";
import { LLMConfig, LLMError } from "./types";

export const loadLLMConfigFromEnv = (): Effect.Effect<LLMConfig, LLMError> => {
  const baseURL = process.env.LLM_BASE_URL;
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL;
  const temperature = process.env.LLM_TEMPERATURE
    ? parseFloat(process.env.LLM_TEMPERATURE)
    : undefined;
  const maxTokens = process.env.LLM_MAX_TOKENS
    ? parseInt(process.env.LLM_MAX_TOKENS)
    : undefined;

  if (!baseURL) {
    return Effect.fail(new LLMError("LLM_BASE_URL is required"));
  }
  if (!apiKey) {
    return Effect.fail(new LLMError("LLM_API_KEY is required"));
  }
  if (!model) {
    return Effect.fail(new LLMError("LLM_MODEL is required"));
  }

  return Effect.succeed({
    baseURL,
    apiKey,
    model,
    temperature,
    maxTokens,
  });
};
