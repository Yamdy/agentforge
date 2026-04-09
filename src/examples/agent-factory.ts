/**
 * @fileoverview Agent factory usage example
 * Demonstrates different ways to create an agent using the factory
 */

import { AgentFactory, createAgent } from '../agent/factory.js';
import { validateAgentConfig, loadConfigSync } from '../config/index.js';
import { InMemoryHistory } from '../memory/index.js';
import { ToolRegistry } from '../registry.js';
import dotenv from 'dotenv';

dotenv.config();

function quickStartExample() {
  console.log('=== Quick Start Example ===\n');

  // Create agent in one line with minimal config
  const agent = createAgent({
    name: 'My Quick Agent',
    description: 'A quickly created agent',
    systemPrompt: 'You are a helpful assistant.',
  });

  console.log('✓ Agent created:', agent.config.name);
  console.log('✓ Model:', agent.config.model);
  return agent;
}

function advancedFactoryExample() {
  console.log('\n=== Advanced Factory Example ===\n');

  // Pre-configure components for dependency injection
  const customHistory = new InMemoryHistory();
  const customRegistry = new ToolRegistry();

  // Use builder pattern with pre-configured components
  const factory = new AgentFactory(
    {
      name: 'Advanced Agent',
      model: 'gpt-4o',
      temperature: 0.7,
      maxSteps: 15,
      systemPrompt: 'You are an advanced assistant with custom components.',
    },
    {
      history: customHistory,
      registry: customRegistry,
      registerBuiltinTools: true,
    }
  );

  const agent = factory.create();
  console.log('✓ Advanced agent created with custom components');
  return agent;
}

function fromLoadedConfigExample() {
  console.log('\n=== From Loaded Config Example ===\n');

  try {
    // You can load config from file and pass directly to factory
    const loader = new ConfigLoader();
    const foundPath = loader.findConfigFile();

    if (foundPath) {
      const config = loader.loadConfigSync();
      const agent = AgentFactory.fromConfig(config);
      console.log('✓ Agent created from loaded config:', config.name);
      return agent;
    }
  } catch (error) {
    console.log('⚠ No config file found, skipping example');
  }
}

export { quickStartExample, advancedFactoryExample, fromLoadedConfigExample };

// Run if called directly
if (require.main === module) {
  quickStartExample();
  advancedFactoryExample();
  fromLoadedConfigExample();
  console.log('\nDone!');
}
