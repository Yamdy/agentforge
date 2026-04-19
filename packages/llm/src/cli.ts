#!/usr/bin/env node

import { Effect } from "effect";
import { Command } from "commander";
import {
  loadLLMConfigFromJson,
  OpenAICompatibleProvider,
  LLMError,
} from "./index";
import {
  CLI_EMOJIS,
  CLI_MESSAGES,
  CLI_SEPARATOR,
  EXIT_CODES,
} from "./constants";

const program = new Command();

program
  .name("agentforge-llm")
  .description("CLI for testing LLM integration")
  .option("-c, --config <path>", "Path to config JSON file")
  .argument("<prompt>", "The prompt to send to the LLM")
  .action(async (prompt: string, options: { config?: string }) => {
    const runLLM = (prompt: string, configPath?: string) =>
      loadLLMConfigFromJson(configPath).pipe(
        Effect.tap(() =>
          Effect.sync(() =>
            console.log(`${CLI_EMOJIS.LOADING_CONFIG} ${CLI_MESSAGES.LOADING_CONFIG}`)
          )
        ),
        Effect.flatMap((config) =>
          Effect.sync(() => {
            console.log(
              `${CLI_EMOJIS.INIT_PROVIDER} ${CLI_MESSAGES.INIT_PROVIDER}`
            );
            return new OpenAICompatibleProvider(config);
          })
        ),
        Effect.tap(() =>
          Effect.sync(() =>
            console.log(`${CLI_EMOJIS.SENDING_PROMPT} ${CLI_MESSAGES.SENDING_PROMPT}`)
          )
        ),
        Effect.flatMap((provider) =>
          provider.generate({
            messages: [{ role: "user", content: prompt }],
          })
        ),
        Effect.tap((response) =>
          Effect.sync(() => {
            console.log(`\n${CLI_EMOJIS.RESPONSE} ${CLI_MESSAGES.RESPONSE_HEADER}`);
            console.log(CLI_SEPARATOR);
            console.log(response);
            console.log(CLI_SEPARATOR);
          })
        )
      );

    try {
      await Effect.runPromise(runLLM(prompt, options.config));
    } catch (e) {
      if (e instanceof LLMError) {
        console.error(`\n${CLI_EMOJIS.ERROR} ${CLI_MESSAGES.ERROR_HEADER}`, e.message);
      } else {
        console.error(`\n${CLI_EMOJIS.ERROR} ${CLI_MESSAGES.UNEXPECTED_ERROR}`, e);
      }
      process.exit(EXIT_CODES.ERROR);
    }
  });

program.parse();
