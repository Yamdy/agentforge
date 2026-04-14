/**
 * @fileoverview Custom configuration path example
 * Demonstrates how to load configuration from a specific file path
 */

import { loadConfigSync, ConfigLoader } from '../config/index.js';
import { createAgent } from '../agent/factory.js';
import path from 'path';

/**
 * Example 1: Load from explicit file path
 */
function loadFromSpecificPath() {
  console.log('=== Load from Specific Path ===\n');

  const configPath = path.join(process.cwd(), 'my-agent.config.md');

  try {
    const config = loadConfigSync({ filePath: configPath });
    console.log('✓ Loaded config from specific path:', configPath);
    console.log('✓ Config name:', config.name);
    return config;
  } catch (error) {
    console.log('⚠ Example config file not found:', configPath);
    console.log('💡 Create this file to run this example');
    return null;
  }
}

/**
 * Example 2: Multiple custom search paths
 */
async function multipleSearchPathsExample() {
  console.log('\n=== Multiple Search Paths Example ===\n');

  // Define multiple search paths in order of priority
  const loader = new ConfigLoader([
    path.join(process.env.HOME || '', '.config/primo'),
    path.join('/etc/primo'),
    path.join('./config'),
  ]);

  const foundPath = loader.findConfigFile();
  if (foundPath) {
    console.log('✓ Found config in one of the search paths:', foundPath);
    const config = loader.loadConfigSync();
    const agent = await createAgent(config);
    console.log('✓ Agent created successfully');
  } else {
    console.log('⚠ No config found in any of the custom search paths');
  }
}

/**
 * Example 3: Load from JSON config
 */
function loadJsonConfigExample() {
  console.log('\n=== JSON Configuration Example ===\n');

  const jsonPath = path.join(process.cwd(), 'primo.config.json');

  try {
    const config = loadConfigSync({ filePath: jsonPath });
    console.log('✓ Loaded JSON config from:', jsonPath);
    return config;
  } catch (error) {
    console.log('⚠ JSON config file not found:', jsonPath);
    return null;
  }
}

export { loadFromSpecificPath, multipleSearchPathsExample, loadJsonConfigExample };

// Run if called directly
if (require.main === module) {
  loadFromSpecificPath();
  multipleSearchPathsExample();
  loadJsonConfigExample();
  console.log('\nDone!');
}
