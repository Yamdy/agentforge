import { describe, it, expect, vi, beforeEach } from "vitest";
import { Effect } from "effect";
import { OpenAICompatibleProvider } from "../src/provider";
import { LLMError } from "../src/types";

vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: vi.fn(),
}));

vi.mock("ai", () => ({
  generateText: vi.fn(),
}));

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";

const mockCreateOpenAICompatible = vi.mocked(createOpenAICompatible);
const mockGenerateText = vi.mocked(generateText);

describe("OpenAICompatibleProvider", () => {
  const testConfig = {
    baseURL: "https://api.test.com",
    apiKey: "test-api-key",
    model: "test-model",
    temperature: 0.7,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should create an instance with config", () => {
    const provider = new OpenAICompatibleProvider(testConfig);
    expect(provider).toBeInstanceOf(OpenAICompatibleProvider);
  });

  it("should generate text successfully", async () => {
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
    const result = await Effect.runPromise(
      provider.generate({
        messages: [{ role: "user", content: "Test prompt" }],
      })
    );

    expect(result).toBe("Test response");
    expect(mockCreateOpenAICompatible).toHaveBeenCalledWith({
      baseURL: testConfig.baseURL,
      apiKey: testConfig.apiKey,
    });
    expect(mockChatModel).toHaveBeenCalledWith(testConfig.model);
    expect(mockGenerateText).toHaveBeenCalledWith({
      model: "mock-model-instance",
      messages: [{ role: "user", content: "Test prompt" }],
      temperature: testConfig.temperature,
    });
  });

  it("should use params.model when provided", async () => {
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
        messages: [{ role: "user", content: "Test prompt" }],
        model: "custom-model",
      })
    );

    expect(mockChatModel).toHaveBeenCalledWith("custom-model");
  });

  it("should use params.temperature when provided", async () => {
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
        messages: [{ role: "user", content: "Test prompt" }],
        temperature: 0.5,
      })
    );

    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        temperature: 0.5,
      })
    );
  });

  it("should throw LLMError when generation fails", async () => {
    const testError = new Error("API Error");
    const mockChatModel = vi.fn();
    const mockProvider = {
      chatModel: mockChatModel,
    };

    mockCreateOpenAICompatible.mockReturnValue(mockProvider as any);
    mockChatModel.mockReturnValue("mock-model-instance" as any);
    mockGenerateText.mockRejectedValue(testError);

    const provider = new OpenAICompatibleProvider(testConfig);

    await expect(
      Effect.runPromise(
        provider.generate({
          messages: [{ role: "user", content: "Test prompt" }],
        })
      )
    ).rejects.toThrow(LLMError);
  });
});
