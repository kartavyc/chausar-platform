import type {DatedRule} from '../kit/define.ts';
export const IT_TRIAGE_RULES:DatedRule[]=[
  {
    "id": "slack-commercial",
    "scope": "Slack",
    "topic": "Commercial Slack qualification",
    "rule": "Do not connect or publish until commercial distribution and workspace installation are qualified.",
    "sources": [
      {
        "title": "Slack API terms",
        "url": "https://slack.com/terms-of-service/api"
      },
      {
        "title": "Slack Socket Mode",
        "url": "https://docs.slack.dev/apis/events-api/using-socket-mode/"
      }
    ],
    "checkedOn": "2026-10-29",
    "read": "official",
    "how": "Read the official API terms and Socket Mode envelope documentation.",
    "usedBy": [
      "post"
    ],
    "limitations": "No production connection is qualified. A lawyer must confirm commercial use before live posting.",
    "needs": "lawyer",
    "confirmedBy": null
  },
  {
    "id": "source-not-authority",
    "scope": "house",
    "topic": "Channel messages are untrusted evidence",
    "rule": "Hold secret or instructive messages and approve every exact reply.",
    "sources": [],
    "checkedOn": "2026-10-29",
    "read": "house",
    "how": "Source screening and exact quote checks refuse unsupported content.",
    "usedBy": [
      "read",
      "summarise",
      "approve"
    ],
    "limitations": "A summary is not a repair, payment or account change.",
    "needs": null
  }
];
