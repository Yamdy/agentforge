/**
 * @fileoverview Basic configuration usage example
 * Demonstrates how to load and validate configuration from file
 */

import { loadConfig, ConfigLoader } from '../config/index.js';
import { createAgent } from '../agent/factory.js';
import dotenv from 'dotenv';

dotenv.config();

async function basicConfigExample() {
  console.log('=== Basic Configuration Example ===\n');

  // Load configuration automatically searching in default paths
  try {
    const config = await loadConfig();
    console.log('✓ Loaded config:', JSON.stringify(config, null, 2));

    // Create agent from config
    const agent = createAgent(config);
    console.log('\n✓ Created agent successfully');

    return agent;
  } catch (error) {
    console.error('✗ Error loading config:', (error as Error).message);
    throw error;
  }
}

function customSearchPathExample() {
  console.log('\n=== Custom Search Path Example ===\n');

  // Create loader with custom search paths
  const loader = new ConfigLoader(['./config', './configs', './my-custom-configs']);

  const foundPath = loader.findConfigFile();
  if (foundPath) {
    console.log('✓ Found config at:', foundPath);
    const config = loader.loadConfigSync({ filePath: foundPath });
    console.log('✓ Loaded config: ' + config.name);
  } else {
    console.log('⚠ No config found in custom search paths');
  }
}

export { basicConfigExample, customSearchPathExample };

// Run if called directly
if (require.main === module) {
  basicConfigExample()
    .then(() => {
      customSearchPathExample();
      console.log('\nDone!');
    })
    .catch(() => process.exit(1));
}
