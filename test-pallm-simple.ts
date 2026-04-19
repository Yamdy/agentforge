#!/usr/bin/env tsx
/**
 * 简单测试PaLLM是否返回工具调用
 */

import { OpenAI } from "@ai-sdk/openai";
import { generateText, tool } from "ai";
import { z } from "zod";

const model = new OpenAI({
  baseURL: "https://ark.cn-beijing.volces.com/api/coding/v3",
  apiKey: "28baa4bf-59c6-4583-aecd-cbae71bde493",
  model: "ark-code-latest",
}).chatModel;

async function test() {
  console.log("🚀 测试PaLLM工具调用\n");

  const result = await generateText({
    model,
    messages: [
      { role: "user", content: "123加456等于多少？" }
    ],
    tools: {
      add_numbers: tool({
        description: "计算两个数字的和",
        parameters: z.object({
          a: z.number().describe("第一个数字"),
          b: z.number().describe("第二个数字")
        }),
        execute: async ({ a, b }) => a + b
      })
    }
  });

  console.log("回复文本：", result.text);
  console.log("工具调用：", result.toolCalls);
}

test().catch(console.error);
