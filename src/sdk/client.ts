export interface AgentForgeClientConfig {
  baseUrl: string;
  apiKey?: string;
}

export interface RunResult {
  result: string;
}

export interface StreamEvent {
  type: string;
  content?: string;
  id?: string;
  name?: string;
  arguments?: string;
  result?: string;
  response?: any;
}

export interface AgentStatus {
  status: string;
  step: number;
  maxSteps: number;
  error?: string;
}

export class AgentForgeClient {
  private baseUrl: string;
  private apiKey?: string;

  constructor(config: AgentForgeClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
  }

  private async request<T = any>(path: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => ({ message: 'Request failed' }))) as {
        message?: string;
        error?: string;
      };
      throw new Error(errorBody.message || errorBody.error || `HTTP ${response.status}`);
    }

    return response.json() as Promise<T>;
  }

  async run(input: string, options?: { maxSteps?: number }): Promise<string> {
    const result = await this.request<RunResult>('/api/agent/run', {
      method: 'POST',
      body: JSON.stringify({ input, ...options }),
    });
    return result.result;
  }

  async runWithSession(sessionId: string, input: string): Promise<string> {
    const result = await this.request<RunResult>(`/api/sessions/${sessionId}/run`, {
      method: 'POST',
      body: JSON.stringify({ input }),
    });
    return result.result;
  }

  async *runStream(
    input: string,
    options?: { sessionId?: string }
  ): AsyncGenerator<StreamEvent, void, unknown> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    let url = `${this.baseUrl}/api/agent/run/stream`;
    let body = JSON.stringify({ input });

    if (options?.sessionId) {
      url = `${this.baseUrl}/api/sessions/${options.sessionId}/run/stream`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
    });

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => ({ message: 'Request failed' }))) as {
        message?: string;
      };
      throw new Error(errorBody.message || `HTTP ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;

        const data = trimmed.slice(6);
        try {
          const event = JSON.parse(data);
          yield event;
          if (event.type === 'done') break;
        } catch {
          // Skip invalid JSON
        }
      }
    }
  }

  async getStatus(): Promise<AgentStatus> {
    return this.request<AgentStatus>('/api/agent/status');
  }

  async healthCheck(): Promise<{ status: string; timestamp: string }> {
    return this.request('/health');
  }

  async createSession(options?: {
    title?: string;
    messages?: { role: string; content: string }[];
    parentId?: string;
    projectId?: string;
  }): Promise<any> {
    return this.request('/api/sessions', {
      method: 'POST',
      body: JSON.stringify(options || {}),
    });
  }

  async listSessions(options?: {
    limit?: number;
    offset?: number;
    parentId?: string;
    projectId?: string;
  }): Promise<any[]> {
    const params = new URLSearchParams();
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.offset) params.set('offset', String(options.offset));
    if (options?.parentId) params.set('parentId', options.parentId);
    if (options?.projectId) params.set('projectId', options.projectId);
    const query = params.toString();
    return this.request(`/api/sessions${query ? '?' + query : ''}`);
  }

  async getSession(id: string): Promise<any> {
    return this.request(`/api/sessions/${id}`);
  }

  async updateSession(
    id: string,
    updates: { title?: string; messages?: any[]; parentId?: string; projectId?: string }
  ): Promise<any> {
    return this.request(`/api/sessions/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  }

  async deleteSession(id: string): Promise<{ success: boolean }> {
    return this.request(`/api/sessions/${id}`, { method: 'DELETE' });
  }
}

export function createAgentForgeClient(config: AgentForgeClientConfig): AgentForgeClient {
  return new AgentForgeClient(config);
}
