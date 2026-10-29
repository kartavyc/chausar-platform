// Browser VA metadata pinned by venture-va-ui-metadata.test.ts.
export const VA_META = {
  "registration": {
    "id": "virtual-assistant",
    "label": "Virtual assistant service",
    "serviceType": "support",
    "picks": [
      "virtual assistant",
      "personal assistant service",
      "errands service",
      "executive assistant service"
    ],
    "summary": "Agents keep client routines, reminders and research moving; you approve every send and purchase.",
    "riskLevel": "medium",
    "lastReviewed": "2026-10-29"
  },
  "offers": [
    {
      "id": "va-monthly",
      "name": "Monthly assistant by hours band",
      "description": "Monthly assistant by hours band",
      "pricing": "monthly",
      "unit": "per client per month",
      "intake": [
        "scope",
        "deliverable",
        "deadline",
        "hoursBand"
      ],
      "rights": []
    },
    {
      "id": "errands-pack",
      "name": "Errands pack",
      "description": "Errands pack",
      "pricing": "project",
      "unit": "per pack",
      "intake": [
        "scope",
        "deliverable",
        "deadline",
        "hoursBand"
      ],
      "rights": []
    }
  ],
  "intakeFields": [
    {
      "id": "scope",
      "label": "Scope",
      "help": "Name the work the client needs.",
      "kind": "text",
      "required": true
    },
    {
      "id": "deliverable",
      "label": "Deliverable",
      "help": "Describe what the client will receive.",
      "kind": "text",
      "required": true
    },
    {
      "id": "deadline",
      "label": "Deadline",
      "help": "Choose a real calendar day.",
      "kind": "date",
      "required": true
    },
    {
      "id": "hoursBand",
      "label": "Hours band",
      "help": "Use the hours band agreed with the client.",
      "kind": "text",
      "required": true
    }
  ],
  "clientRoom": true
} as const;
