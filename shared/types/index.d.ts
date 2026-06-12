// Shared TypeScript types used across all services and clients

export type OutcomeStatus = 'pending' | 'ghosted' | 'rejected' | 'interview' | 'offer';

export interface User {
  id: string;
  email: string;
  ats_score_cache: number | null;
  created_at: string;
}

export interface Application {
  id: string;
  user_id: string;
  company_id: string;
  role_title: string;
  jd_fingerprint_hash: string | null;
  ats_score_at_apply: number | null;
  outcome: OutcomeStatus;
  response_days: number | null;
  applied_at: string;
}

export interface ApplicationLoggedEvent {
  applicationId: string;
  userId: string;
  companyId: string;
  jdFingerprintHash: string;
  atsScoreAtApply: number;
  appliedAt: string;
}

export interface OutcomeUpdatedEvent {
  applicationId: string;
  anonymisedCohortId: string;
  outcome: OutcomeStatus;
  responseDays: number | null;
}

export interface PatternComputedEvent {
  patternIds: string[];
  affectedCohorts: string[];
  computedAt: string;
}
