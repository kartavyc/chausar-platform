import type {PlaybookRegistration} from '../registry.ts';
export const IT_TRIAGE_REGISTRATION:PlaybookRegistration={
  "id": "it-triage",
  "label": "IT triage desk",
  "serviceType": "support",
  "picks": [
    "it support desk",
    "on-call triage",
    "slack support bot",
    "it helpdesk for"
  ],
  "summary": "Agents read permitted help-channel evidence and prepare triage summaries; every reply waits for you.",
  "riskLevel": "medium",
  "lastReviewed": "2026-10-29"
};
