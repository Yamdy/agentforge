import { api } from './client';
import type { AgentInfo } from '../types';

export async function fetchAgents(): Promise<{ agents: AgentInfo[] }> {
  return api('/agents');
}
