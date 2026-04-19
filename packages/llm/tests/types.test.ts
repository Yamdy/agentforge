import { describe, it, expect } from "vitest";
import { Message, LLMError, type LLMConfig, type LLMProvider } from "../src/types";

describe("LLM Types", () => {
  describe("Message", () => {
    it("should create a user message", () => {
      const message: Message = {
        role: "user",
        content: "Hello, world!",
      };
      expect(message.role).toBe("user");
      expect(message.content).toBe("Hello, world!");
    });

    it("should create an assistant message", () => {
      const message: Message = {
        role: "assistant",
        content: "Hi there!",
      };
      expect(message.role).toBe("assistant");
      expect(message.content).toBe("Hi there!");
    });

    it("should create a system message", () => {
      const message: Message = {
        role: "system",
        content: "You are a helpful assistant.",
      };
      expect(message.role).toBe("system");
      expect(message.content).toBe("You are a helpful assistant.");
    });
  });

  describe("LLMError", () => {
    it("should create an LLMError with message", () => {
      const error = new LLMError("Something went wrong");
      expect(error._tag).toBe("LLMError");
      expect(error.message).toBe("Something went wrong");
      expect(error.cause).toBeUndefined();
    });

    it("should create an LLMError with message and cause", () => {
      const cause = new Error("Original error");
      const error = new LLMError("Wrapped error", cause);
      expect(error._tag).toBe("LLMError");
      expect(error.message).toBe("Wrapped error");
      expect(error.cause).toBe(cause);
    });
  });

  describe("LLMConfig", () => {
    it("should create a valid LLMConfig", () => {
      const config: LLMConfig = {
        baseURL: "https://api.example.com",
        apiKey: "test-api-key",
        model: "test-model",
      };
      expect(config.baseURL).toBe("https://api.example.com");
      expect(config.apiKey).toBe("test-api-key");
      expect(config.model).toBe("test-model");
      expect(config.temperature).toBeUndefined();
      expect(config.maxTokens).toBeUndefined();
    });

    it("should create an LLMConfig with optional fields", () => {
      const config: LLMConfig = {
        baseURL: "https://api.example.com",
        apiKey: "test-api-key",
        model: "test-model",
        temperature: 0.7,
        maxTokens: 1000,
      };
      expect(config.temperature).toBe(0.7);
      expect(config.maxTokens).toBe(1000);
    });
  });

  describe("LLMProvider interface", () => {
    it("should be implementable", () => {
      class TestProvider implements LLMProvider {
        generate() {
          return {
            pipe: () => this,
          } as any;
        }
      }
      const provider = new TestProvider();
      expect(typeof provider.generate).toBe("function");
    });
  });
});
