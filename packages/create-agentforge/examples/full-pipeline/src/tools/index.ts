/**
 * Tool registry for full-pipeline agent.
 */

import { SimpleToolRegistry } from 'agentforge';
import { weatherTool } from './weather.js';

export const tools = new SimpleToolRegistry();
tools.register(weatherTool);