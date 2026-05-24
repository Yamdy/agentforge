import { AgentFactory, createAgent } from '../agent/factory.js';
import { InMemoryStorage } from '../memory/index.js';
import { ToolRegistry } from '../registry.js';
import { ConfigLoader } from '../config/loader.js';
import dotenv from 'dotenv';

dotenv.config();

async function quickStartExample() {
  console.log('=== Quick Start Example ===\n');

  const agent = await createAgent({
    name: 'My Quick Agent',
    middleware: [],
    tools: [],
    model: 'gpt-4o',
    maxSteps: 10,
    plugins: [],
    systemPrompt: 'You are a helpful assistant.',
  });

  console.log('✓ Agent created');
  return agent;
}

async function advancedFactoryExample() {
  console.log('\n=== Advanced Factory Example ===\n');

  const customStorage = new InMemoryStorage();
  const customRegistry = new ToolRegistry();

  const factory = new AgentFactory(
    {
      name: 'Advanced Agent',
      middleware: [],
      tools: [],
      model: 'gpt-4o',
      maxSteps: 15,
      plugins: [],
      temperature: 0.7,
      systemPrompt: 'You are an advanced assistant with custom components.',
    },
    {
      history: customStorage as never,
      registry: customRegistry,
      registerBuiltinTools: true,
    }
  );

  const agent = await factory.create();
  console.log('✓ Advanced agent created with custom components');
  return agent;
}

async function fromLoadedConfigExample() {
  console.log('\n=== From Loaded Config Example ===\n');

  try {
    const loader = new ConfigLoader();
    const config = loader.loadConfigSync();

    if (config) {
      const agent = await AgentFactory.fromConfig(config);
      console.log('✓ Agent created from loaded config');
      return agent;
    }
  } catch {
    console.log('⚠ No config file found, skipping example');
  }
}

export { quickStartExample, advancedFactoryExample, fromLoadedConfigExample };
