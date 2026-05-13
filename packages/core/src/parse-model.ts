export interface ParsedModel {
  provider: string;
  modelId: string;
}

export function parseModel(modelString: string): ParsedModel {
  const idx = modelString.indexOf('/');
  if (idx < 1 || idx === modelString.length - 1) {
    throw new Error(
      `Invalid model string: "${modelString}". Expected format: "provider/model-name"`,
    );
  }
  return {
    provider: modelString.slice(0, idx),
    modelId: modelString.slice(idx + 1),
  };
}
