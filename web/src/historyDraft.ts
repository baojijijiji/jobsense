import type { CareerDraft } from './careerDraft.ts'

/** Changing matching inputs/results invalidates the association with an already assembled resume. */
export function reviseMatching(previous: CareerDraft, next: CareerDraft): CareerDraft {
  const fields = ['jobText', 'matchedJob', 'results', 'selectedIds', 'skillSelections', 'aiFocus'] as const
  return fields.some((field) => JSON.stringify(previous[field]) !== JSON.stringify(next[field]))
    ? { ...next, resumeJob: previous.resumeJob ?? previous.matchedJob, matchRevision: crypto.randomUUID() }
    : next
}

export function historyDraftIsAligned(draft: CareerDraft) {
  return draft.generated && draft.matchedJob.trim().length >= 10 && draft.jobText.trim() === draft.matchedJob
    && (draft.resumeJob === undefined || draft.resumeJob === draft.matchedJob)
    && draft.resumeMatchRevision === draft.matchRevision
}
