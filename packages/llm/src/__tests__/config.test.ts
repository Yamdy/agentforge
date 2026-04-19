import { describe, it, expect, vi, beforeEach } from "vitest";
import { Effect } from "effect";
import { loadLLMConfigFromJson } from "../config";
import { LLMError } from "../types";
import fs from "fs/promises";

vi.mock("fs/promises");

const mockFs = vi.mocked(fs);

describe("loadLLMConfigFromJson", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should load valid config successfully", async () => {
    const testConfig = {
      llm: {
        baseURL: "https://api.test.com",
        apiKey: "test-api-key",
        model: "test-model",
        temperature: 0.8,
      },
    };

    mockFs.readFile.mockResolvedValue(JSON.stringify(testConfig));

    const result = await Effect.runPromise(loadLLMConfigFromJson("test-path"));

    expect(result).toEqual(testConfig.llm);
    expect(mockFs.readFile).toHaveBeenCalledWith("test-path", "utf-8");
  });

  it("should throw error when llm section is missing", async () => {
    const testConfig = {};
    mockFs.readFile.mockResolvedValue(JSON.stringify(testConfig));

    await expect(
      Effect.runPromise(loadLLMConfigFromJson("test-path"))
    ).rejects.toThrow(LLMError);
  });

  it("should throw error when baseURL is missing", async () => {
    const testConfig = {
      llm: {
        apiKey: "test-api-key",
        model: "test-model",
      },
    };
    mockFs.readFile.mockResolvedValue(JSON.stringify(testConfig));

    await expect(
      Effect.runPromise(loadLLMConfigFromJson("test-path"))
    ).rejects.toThrow(LLMError);
  });

  it("should throw error when apiKey is missing", async () => {
    const testConfig = {
      llm: {
        baseURL: "https://api.test.com",
        model: "test-model",
      },
    };
    mockFs.readFile.mockResolvedValue(JSON.stringify(testConfig));

    await expect(
      Effect.runPromise(loadLLMConfigFromJson("test-path"))
    ).rejects.toThrow(LLMError);
  });

  it("should throw error when model is missing", async () => {
    const testConfig = {
      llm: {
        baseURL: "https://api.test.com",
        apiKey: "test-api-key",
      },
    };
    mockFs.readFile.mockResolvedValue(JSON.stringify(testConfig));

    await expect(
      Effect.runPromise(loadLLMConfigFromJson("test-path"))
    ).rejects.toThrow(LLMError);
  });

  it("should throw error when file read fails", async () => {
    const testError = new Error("File not found");
    mockFs.readFile.mockRejectedValue(testError);

    await expect(
      Effect.runPromise(loadLLMConfigFromJson("test-path"))
    ).rejects.toThrow(LLMError);
  });

  it("should throw error when JSON is invalid", async () => {
    mockFs.readFile.mockResolvedValue("invalid json");

    await expect(
      Effect.runPromise(loadLLMConfigFromJson("test-path"))
    ).rejects.toThrow(LLMError);
  });
});
