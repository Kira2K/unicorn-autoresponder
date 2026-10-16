/** New writes use one final CV status; old reads remain compatible during rollout/rollback. */
export const CV_DONE_STATUS = "CV done";
export function isFinalCvStatus(value: unknown): boolean {
  return ["cv done", "moved to filling", "filled"].includes(
    String(value ?? "")
      .trim()
      .toLowerCase(),
  );
}
