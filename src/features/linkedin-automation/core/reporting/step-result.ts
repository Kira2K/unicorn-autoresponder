export type StepStatus =
  | 'verified'
  | 'failed'
  | 'skipped'
  | 'cancelled';

export type StepResult<TSection extends string = string> = {
  stepId: string;
  section: TSection;
  status: StepStatus;
  message: string;
  startedAt?: string;
  finishedAt?: string;
};
