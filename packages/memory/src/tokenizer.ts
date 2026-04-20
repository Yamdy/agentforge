import { encode } from "gpt-3-encoder";

/**
 * Default GPT tokenizer using gpt-3-encoder
 * Gives accurate token counting
 */
export class GPTTokenizer {
  count(text: string): number {
    return encode(text).length;
  }

  encode(text: string): number[] {
    return encode(text);
  }
}

/**
 * Estimate token count using simple 4 chars = 1 token approximation
 * Fast, no dependencies, good enough for trimming
 */
export class SimpleEstimateTokenizer {
  count(text: string): number {
    return Math.ceil(text.length / 4);
  }
}