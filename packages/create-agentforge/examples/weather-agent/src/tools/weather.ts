/**
 * Weather tool for weather-agent.
 * Demonstrates tool definition with Zod schema.
 */

import { z } from 'zod';
import type { ToolDefinition } from 'agentforge';

/**
 * Input schema for weather tool
 */
const WeatherInputSchema = z.object({
  city: z.string().describe('City name to get weather for'),
  unit: z.enum(['celsius', 'fahrenheit']).optional().default('celsius').describe('Temperature unit'),
});

/**
 * Weather tool definition
 */
export const weatherTool: ToolDefinition = {
  name: 'get_weather',
  description: 'Get the current weather for a city. Returns temperature and conditions.',
  parameters: WeatherInputSchema,

  /**
   * Execute the weather tool
   */
  async execute(input: z.infer<typeof WeatherInputSchema>): Promise<string> {
    // This is a mock implementation
    // In production, you would call a real weather API
    const { city, unit } = input;

    // Simulated weather data
    const mockWeather = {
      temperature: unit === 'fahrenheit' ? 72 : 22,
      conditions: 'Partly cloudy',
      humidity: 65,
      wind: '10 km/h NW',
    };

    return JSON.stringify({
      city,
      temperature: `${mockWeather.temperature}°${unit === 'fahrenheit' ? 'F' : 'C'}`,
      conditions: mockWeather.conditions,
      humidity: `${mockWeather.humidity}%`,
      wind: mockWeather.wind,
    });
  },
};