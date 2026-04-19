#!/usr/bin/env node

import { Effect } from "effect";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(import.meta.dirname, "../../../.env") });
import { Command } from "commander";
import {
  loadLLMConfigFromEnv,
  OpenAICompatibleProvider,
  LLMError,
} from "./index";

const program = new Command();

program
  .name("agentforge-llm")
  .description("CLI for testing LLM integration")
  .argument("<prompt>", "The prompt to send to the LLM")
  .action(async (prompt: string) => {
    const runLLM = (prompt: string) =>
      loadLLMConfigFromEnv().pipe(
        Effect.tap(() => Effect.sync(() => console.log("🤖 Loading LLM config..."))),
        Effect.flatMap((config) =>
          Effect.sync(() => {
            console.log("🔌 Initializing LLM provider...");
            return new OpenAICompatibleProvider(config);
          })
        ),
        Effect.tap(() => Effect.sync(() => console.log("💬 Sending prompt to LLM..."))),
        Effect.flatMap((provider) =>
          provider.generate({
            messages: [{ role: "user", content: prompt }],
          })
        ),
        Effect.tap((response) =>
          Effect.sync(() => {
            console.log("\n✅ LLM Response:");
            console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
            console.log(response);
            console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
          })
        )
      );

    try {
      await Effect.runPromise(runLLM(prompt));
    } catch (e) {
      if (e instanceof LLMError) {
        console.error("\n❌ Error:", e.message);
      } else {
        console.error("\n❌ Unexpected error:", e);
      }
      process.exit(1);
    }
  });

program.parse();
