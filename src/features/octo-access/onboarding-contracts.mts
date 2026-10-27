import type { ProxyInput, Locale } from './contracts.mts';

export interface ProxySetup {
  id: string;
  source: 'none' | 'own' | 'nodemaven' | 'dolphin' | 'manual' | 'direct';
  phase: 'queued' | 'checking' | 'awaiting_confirmation' | 'provisioning' | 'complete' | 'blocked' | 'unknown';
  createdAt: number; startedAt?: number; completedAt?: number; error?: string; score?: number;
  input?: ProxyInput;
  location?: { country: string; region?: string; city?: string };
  profileIds?: number[]; acceptLowScore?: boolean; confirmDolphin: boolean;
  locales?: Locale[];
}
export interface ClientState {
  clientId: number; revision: number; password: string; nodeMavenKey?: string; setup?: ProxySetup;
}
