// Original source-service capability catalogue. Unqualified provider effects stay planned.
import type {CatalogueEntry} from '../catalogue.ts';
export const IT_TRIAGE_CATALOGUE:readonly CatalogueEntry[]=Object.freeze([
  {
    "id": "slack-socket",
    "name": "Client Slack help channel",
    "category": "messaging",
    "auth": "Planned owner-admin workspace installation",
    "regions": [
      "india",
      "global"
    ],
    "regionNote": null,
    "note": "Live connection waits for Slack commercial permission and installation review. Paste permitted messages and send approved text manually meanwhile.",
    "vendorUrl": null,
    "targets": [
      "write"
    ]
  },
  {
    "id": "teams",
    "name": "Client Microsoft Teams help channel",
    "category": "messaging",
    "auth": "Planned tenant consent and bot registration",
    "regions": [
      "india",
      "global"
    ],
    "regionNote": null,
    "note": "Live connection waits for client tenant consent and bot registration. Copy approved summaries manually meanwhile.",
    "vendorUrl": null,
    "targets": [
      "write"
    ]
  },
  {
    "id": "triage-copy",
    "name": "Help-channel manual handoff",
    "category": "docs-ops",
    "auth": "Owner-reviewed permitted channel evidence",
    "regions": [
      "india",
      "global"
    ],
    "regionNote": null,
    "note": "Download the exact approved source summary. No message is sent and no system is changed.",
    "vendorUrl": null,
    "targets": [
      "handoff"
    ]
  }
]);
