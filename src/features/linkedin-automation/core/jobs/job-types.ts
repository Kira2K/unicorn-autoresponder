import type { StepResult } from '../reporting/step-result';

export type AutomationJobType = 'read_only' | 'mutation';

export type AutomationJobStatus =
  | 'pending'
  | 'waiting'
  | 'running'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** Shared job state for LinkedIn automation features. */
export type AutomationJob<TSection extends string = string> = {
  id: string;
  type: AutomationJobType;
  kind: string;
  accountId: string;
  status: AutomationJobStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  currentStep: number;
  totalSteps: number;
  cancelRequested: boolean;
  steps: StepResult<TSection>[];
};
