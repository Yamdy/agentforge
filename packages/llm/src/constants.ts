export const DEFAULT_CONFIG_PATH = "../../../config.json";
export const CONFIG_SECTION_LLM = "llm";

export const ERROR_MESSAGES = {
  MISSING_LLM_SECTION: "Config file missing 'llm' section",
  MISSING_BASE_URL: "LLM baseURL is required",
  MISSING_API_KEY: "LLM apiKey is required",
  MISSING_MODEL: "LLM model is required",
  LOAD_CONFIG_FAILED: "Failed to load config",
  LLM_GENERATION_FAILED: "LLM generation failed",
} as const;

export const CLI_EMOJIS = {
  LOADING_CONFIG: "🤖",
  INIT_PROVIDER: "🔌",
  SENDING_PROMPT: "💬",
  RESPONSE: "✅",
  ERROR: "❌",
} as const;

export const CLI_MESSAGES = {
  LOADING_CONFIG: "Loading LLM config...",
  INIT_PROVIDER: "Initializing LLM provider...",
  SENDING_PROMPT: "Sending prompt to LLM...",
  RESPONSE_HEADER: "LLM Response:",
  ERROR_HEADER: "Error:",
  UNEXPECTED_ERROR: "Unexpected error",
} as const;

export const CLI_SEPARATOR = "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━";

export const EXIT_CODES = {
  SUCCESS: 0,
  ERROR: 1,
} as const;
