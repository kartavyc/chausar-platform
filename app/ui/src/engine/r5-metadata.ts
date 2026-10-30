export const MONITORED_META={
  "registration": {
    "id": "monitored-data",
    "label": "Monitored data service",
    "serviceType": "research",
    "picks": [
      "price monitoring",
      "tender alerts",
      "competitor price tracking",
      "data monitoring service"
    ],
    "summary": "Agents watch public pages whose terms allow it and prepare clean client updates for your approval.",
    "riskLevel": "medium",
    "lastReviewed": "2026-10-29"
  },
  "offers": [
    {
      "id": "price-list-watch",
      "name": "Price list watch",
      "description": "Price list watch",
      "pricing": "monthly",
      "unit": "per source",
      "intake": [
        "sourceScope",
        "permission"
      ],
      "rights": []
    },
    {
      "id": "tender-board-watch",
      "name": "Tender board watch",
      "description": "Tender board watch",
      "pricing": "monthly",
      "unit": "per source",
      "intake": [
        "sourceScope",
        "permission"
      ],
      "rights": []
    }
  ],
  "intakeFields": [
    {
      "id": "sourceScope",
      "label": "Client source scope",
      "help": "Name the exact permitted pages and values.",
      "kind": "text",
      "required": true
    },
    {
      "id": "permission",
      "label": "Source permission",
      "help": "Record who permits this source use and its limits.",
      "kind": "text",
      "required": true
    }
  ]
} as const;
export const TRIAGE_META={
  "registration": {
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
  },
  "offers": [
    {
      "id": "triage-desk",
      "name": "Team help-channel triage",
      "description": "Team help-channel triage",
      "pricing": "monthly",
      "unit": "per team",
      "intake": [
        "sourceScope",
        "permission"
      ],
      "rights": []
    }
  ],
  "intakeFields": [
    {
      "id": "sourceScope",
      "label": "Client source scope",
      "help": "Name the exact help channel and requested review.",
      "kind": "text",
      "required": true
    },
    {
      "id": "permission",
      "label": "Source permission",
      "help": "Record who permits this source use and its limits.",
      "kind": "text",
      "required": true
    }
  ]
} as const;
