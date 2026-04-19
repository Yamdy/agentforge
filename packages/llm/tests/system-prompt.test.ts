import { describe, it, expect, vi, beforeEach } from "vitest";
import { Effect } from "effect";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";
import { OpenAICompatibleProvider } from "../src/provider";
import { LLMError } from "../src/types";

vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: vi.fn(),
}));

vi.mock("ai", () => ({
  generateText: vi.fn(),
}));

const mockCreateOpenAICompatible = vi.mocked(createOpenAICompatible);
const mockGenerateText = vi.mocked(generateText);

describe("System Prompt Injection", () => {
  const testConfig = {
    baseURL: "https://api.test.com",
    apiKey: "test-api-key",
    model: "test-model",
    temperature: 0.7,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should inject system prompt at the beginning of messages", async () => {
    const mockChatModel = vi.fn();
    const mockProvider = {
      chatModel: mockChatModel,
    };

    mockCreateOpenAICompatible.mockReturnValue(mockProvider as any);
    mockChatModel.mockReturnValue("mock-model-instance" as any);
    mockGenerateText.mockResolvedValue({
      text: "Test response",
    } as any);

    const provider = new OpenAICompatibleProvider(testConfig);
    await Effect.runPromise(
      provider.generate({
        messages: [
          { role: "user", content: "User message" },
        ],
        systemPrompt: "You are a helpful assistant.",
      })
    );

    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: "User message" },
        ],
      })
    );
  });

  it("should not add duplicate system prompt if one already exists", async () => {
    const mockChatModel = vi.fn();
    const mockProvider = {
      chatModel: mockChatModel,
    };

    mockCreateOpenAICompatible.mockReturnValue(mockProvider as any);
    mockChatModel.mockReturnValue("mock-model-instance" as any);
    mockGenerateText.mockResolvedValue({
      text: "Test response",
    } as any);

    const provider = new OpenAICompatibleProvider(testConfig);
    await Effect.runPromise(
      provider.generate({
        messages: [
          { role: "system", content: "Existing system prompt" },
          { role: "user", content: "User message" },
        ],
        systemPrompt: "You are a helpful assistant.",
      })
    );

    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          { role: "system", content: "Existing system prompt" },
          { role: "user", content: "User message" },
        ],
      })
    );
  });

  it("should work without system prompt", async () => {
    const mockChatModel = vi.fn();
    const mockProvider = {
      chatModel: mockChatModel,
    };

    mockCreateOpenAICompatible.mockReturnValue(mockProvider as any);
    mockChatModel.mockReturnValue("mock-model-instance" as any);
    mockGenerateText.mockResolvedValue({
      text: "Test response",
    } as any);

    const provider = new OpenAICompatibleProvider(testConfig);
    await Effect.runPromise(
      provider.generate({
        messages: [
          { role: "user", content: "User message" },
        ],
      })
    );

    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          { role: "user", content: "User message" },
        ],
      })
    );
  });
});
