import type { AssessmentInput } from '../../shared/platform/assessment';
import type { PlatformAnalysis } from '../../shared/platform/analysis';

const DRAFT_KEY = 'hs_assessment_draft_v1';

/** Draft answers are stored on the device ONLY when the person opts in. */
export const draftStore = {
  load(): { answers: Partial<AssessmentInput>; step: number } | null {
    try {
      const v = localStorage.getItem(DRAFT_KEY);
      return v ? JSON.parse(v) : null;
    } catch {
      return null;
    }
  },
  save(answers: Partial<AssessmentInput>, step: number) {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ answers, step }));
    } catch {
      /* storage unavailable */
    }
  },
  clear() {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* ignore */
    }
  },
};

/** Hand-off of answers to "edit" from the results page (session only, no consent needed: same tab). */
const EDIT_KEY = 'hs_assessment_edit_v1';
export const editHandoff = {
  set(a: AssessmentInput) {
    try {
      sessionStorage.setItem(EDIT_KEY, JSON.stringify(a));
    } catch {
      /* ignore */
    }
  },
  take(): AssessmentInput | null {
    try {
      const v = sessionStorage.getItem(EDIT_KEY);
      sessionStorage.removeItem(EDIT_KEY);
      return v ? JSON.parse(v) : null;
    } catch {
      return null;
    }
  },
};

/** Results URLs carry the access token in the #fragment, which browsers never send to servers or in referrers. */
export const resultsPath = (id: string, token: string) => `/savings/results/${encodeURIComponent(id)}#t=${encodeURIComponent(token)}`;
export const tokenFromHash = () => new URLSearchParams(window.location.hash.slice(1)).get('t') ?? '';

export interface ResultsPayload {
  id: string;
  assessment: AssessmentInput;
  analysis: PlatformAnalysis;
  contacted: boolean;
}
