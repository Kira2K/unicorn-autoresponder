import type { ProxyInput } from './contracts.mts';

export interface ProxySetup {
  id: string;
  source: 'none' | 'own' | 'nodemaven' | 'dolphin';
  phase: 'queued' | 'checking' | 'awaiting_confirmation' | 'provisioning' | 'complete' | 'blocked' | 'unknown';
  createdAt: number; startedAt?: number; completedAt?: number; error?: string; score?: number;
  input?: ProxyInput;
  location?: { country: string; region?: string; city?: string };
  profileIds?: number[]; acceptLowScore?: boolean; confirmDolphin: boolean;
}
export interface ClientState {
  clientId: number; revision: number; password: string; nodeMavenKey?: string; setup?: ProxySetup;
}
