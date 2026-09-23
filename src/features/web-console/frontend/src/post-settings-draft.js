// Only user-editable settings participate in the unsaved-changes indicator.
export function writerSettings(value = {}) {
  return { scheduled: value.scheduled ?? false, days: [...(value.days ?? [])],
    likes: value.likes ?? false, memes: value.memes ?? false, manualMode: value.manualMode ?? 'approval_required',
    contentMode: value.contentMode ?? 'generated', preparedPosts: (value.preparedPosts ?? []).map(item => ({ ...item })),
    intervals: (value.intervals ?? [{ start: '10:00', end: '15:00' }]).map(item => ({ ...item })),
    forbiddenTopics: [...(value.forbiddenTopics ?? [])] }
}
