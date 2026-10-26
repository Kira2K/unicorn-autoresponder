import type {Learner} from './types.mts';

/** Start hard preparation after onboarding without carrying an earlier completion into this stage. */
export function startHardPreparation(learner:Learner):void {
  delete learner.hardCompletedAt;
}
