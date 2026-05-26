import { api } from './client';
import type {
  ConstitutionInfo,
  VerificationReportView,
  MutationBudgetStatus,
} from '../types';

export async function fetchSelfModificationAgents(): Promise<{
  agents: Array<{ id: string; hasEngine: boolean }>;
}> {
  return api('/self-modification');
}

export async function fetchConstitution(agentId: string): Promise<ConstitutionInfo> {
  return api(`/self-modification/${agentId}/constitution`);
}

export async function verifyDiff(
  agentId: string,
  diff: Array<{ path: string; content?: string }>,
): Promise<VerificationReportView> {
  return api(`/self-modification/${agentId}/verify`, {
    method: 'POST',
    body: { diff },
  });
}

export async function fetchBudget(agentId: string): Promise<MutationBudgetStatus> {
  return api(`/self-modification/${agentId}/budget`);
}

export async function fetchWatchdog(agentId: string): Promise<{
  state: {
    consecutiveFailures: number;
    lastHealthySnapshot: string;
    lastCheckTime: string;
    totalRollbacks: number;
  };
  healthChecks: Array<{ name: string }>;
}> {
  return api(`/self-modification/${agentId}/watchdog`);
}

export async function fetchAuditLog(agentId: string): Promise<{
  entries: Array<{
    id: string;
    riskLevel: string;
    accepted: boolean;
    reason?: string;
    timestamp: string;
  }>;
}> {
  return api(`/self-modification/${agentId}/audit`);
}
