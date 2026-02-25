export interface ProviderPublic {
  id: string | null;
  organization_id: string;
  provider: string;
  model: string;
  active: boolean;
  use_system_key: boolean;
  created_at: string | null;
  key_configured: boolean;
  api_key_masked: string | null;
  system_key_available: boolean;
}

export interface SaveProviderParams {
  organizationId: string;
  provider: string;
  apiKey?: string;
  model?: string;
  useSystemKey?: boolean;
  active?: boolean;
  db?: unknown;
}

export interface GetProviderParams {
  organizationId: string;
  provider?: string;
  db?: unknown;
}

export interface TestConnectionParams {
  organizationId: string;
  provider?: string;
  db?: unknown;
}

export interface TestConnectionResult {
  ok: boolean;
  provider: string;
  model: string;
  key_source: 'organization' | 'system';
  usage_tokens: number;
  estimated_cost_usd: number;
  checked_at: string;
}

export interface AiClassificationResult {
  category: string;
  confidence: number;
  member: string | null;
  provider: string;
  model: string;
  key_source: 'organization' | 'system';
  usage_tokens: number;
  estimated_cost_usd: number;
}

export interface MonthlyUsageStatsParams {
  organizationId: string;
  month?: number;
  year?: number;
  db?: unknown;
}

export interface MonthlyUsageStats {
  organization_id: string;
  month: number;
  year: number;
  monthly_tokens_used: number;
  estimated_cost_usd: number;
  total_requests: number;
}

export interface ClassifyTransactionWithAiParams {
  organizationId: string;
  description: string;
  categories: string[];
  members: Array<{
    full_name?: string;
    alias?: string | null;
  }>;
  provider?: string;
  db?: unknown;
}

// Runtime implementation lives in .js for the current Node.js service runtime.
const runtime = require('./ai-provider.service.js') as {
  saveProvider: (params: SaveProviderParams) => Promise<ProviderPublic>;
  getProvider: (params: GetProviderParams) => Promise<ProviderPublic | null>;
  decryptKey: (encryptedApiKey: string) => string;
  testConnection: (params: TestConnectionParams) => Promise<TestConnectionResult>;
  classifyTransactionWithAi: (
    params: ClassifyTransactionWithAiParams
  ) => Promise<AiClassificationResult | null>;
  getMonthlyUsageStats: (
    params: MonthlyUsageStatsParams
  ) => Promise<MonthlyUsageStats>;
};

export const saveProvider = runtime.saveProvider;
export const getProvider = runtime.getProvider;
export const decryptKey = runtime.decryptKey;
export const testConnection = runtime.testConnection;
export const classifyTransactionWithAi = runtime.classifyTransactionWithAi;
export const getMonthlyUsageStats = runtime.getMonthlyUsageStats;
