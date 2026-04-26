/**
 * Tool registry for weather-agent.
 */

import { SimpleToolRegistry } from 'agentforge';
import { weatherTool } from './weather.js';

export const tools = new SimpleToolRegistry();
tools.register(weatherTool);