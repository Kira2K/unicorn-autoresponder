/** Exact persisted values. Legacy studying remains valid during the staged rollout. */
export const CLIENT_TRAINING_STATUSES = ["studying", "studying hard", "studying soft"] as const;
export type ClientTrainingStatus = (typeof CLIENT_TRAINING_STATUSES)[number];

export function isClientTrainingStatus(value: unknown): value is ClientTrainingStatus {
  return CLIENT_TRAINING_STATUSES.some(status => status === value);
}
