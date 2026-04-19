#!/usr/bin/env node

import { Effect } from "effect";
import { loadLLMConfigFromJson, OpenAICompatibleProvider, LLMError } from "./index";

const runStream = async () => {
  const config = await Effect.runPromise(loadLLMConfigFromJson("config.json"));
  const provider = new OpenAICompatibleProvider(config);

  console.log("=== Streaming Test ===\n");

  const streamEffect = provider.generateStream({
    messages: [{ role: "user", content: "讲一个关于小鸭子的笑话" }],
  });

  const stream = await Effect.runPromise(streamEffect);

  let fullText = "";

  for await (const event of stream) {
    if (event.type === "text-delta") {
      process.stdout.write(event.content);
      fullText += event.content;
    } else if (event.type === "done") {
      console.log("\n\n=== Done ===");
      console.log("Full text:", fullText);
    }
  }
};

runStream().catch((e) => {
  if (e instanceof LLMError) {
    console.error("LLM Error:", e.message);
  } else {
    console.error("Error:", e);
  }
  process.exit(1);
});