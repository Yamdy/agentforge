import { z } from 'zod';
import type { ToolDefinition } from 'agentforge';

const WeatherInputSchema = z.object({
  city: z.string().describe('City name to get weather for'),
  unit: z.enum(['celsius', 'fahrenheit']).optional().default('celsius').describe('Temperature unit'),
});

export const weatherTool: ToolDefinition = {
  name: 'get_weather',
  description: 'Get the current weather for a city.',
  parameters: WeatherInputSchema,
  async execute(input: z.infer<typeof WeatherInputSchema>): Promise<string> {
    const { city, unit } = input;
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