import type {DatedRule} from '../kit/define.ts';
export const MONITORED_DATA_RULES:DatedRule[]=[
  {
    "id": "source-terms",
    "scope": "per source",
    "topic": "Dated permission for each source",
    "rule": "The owner records the terms URL and allowed use. Robots and site policy may still refuse the read.",
    "sources": [],
    "checkedOn": "2026-10-29",
    "read": "house",
    "how": "Actual terms and selector checks run on every source read.",
    "usedBy": [
      "terms",
      "selectors",
      "watch",
      "extract"
    ],
    "limitations": "A terms tick is not legal advice. The owner resolves unclear permission before enabling reads.",
    "needs": null
  }
];
