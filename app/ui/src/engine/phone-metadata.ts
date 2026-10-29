// Browser metadata pinned by venture-phone-metadata.test.ts.
export const PHONE_META = {
  "registration": {
    "id": "phone-receptionist",
    "label": "AI phone receptionist",
    "serviceType": "support",
    "picks": [
      "phone receptionist",
      "ai receptionist",
      "call answering service",
      "clinic receptionist"
    ],
    "summary": "An AI voice answers your clients' calls with their facts, says it is an AI, and hands every booking and callback to a person; calls run only within the budget you set.",
    "riskLevel": "high",
    "lastReviewed": "2026-10-29"
  },
  "offers": [
    {
      "id": "receptionist-setup",
      "name": "Receptionist setup",
      "description": "Receptionist setup",
      "pricing": "project",
      "unit": "per client",
      "intake": [
        "clientFacts",
        "callerNotice"
      ],
      "rights": []
    },
    {
      "id": "receptionist-monthly",
      "name": "Monthly receptionist",
      "description": "Monthly receptionist",
      "pricing": "monthly",
      "unit": "per client",
      "intake": [
        "clientFacts",
        "callerNotice"
      ],
      "rights": []
    }
  ],
  "intakeFields": [
    {
      "id": "clientFacts",
      "label": "Client facts",
      "help": "Add hours, services, the client price list and common answers.",
      "kind": "text",
      "required": true
    },
    {
      "id": "callerNotice",
      "label": "Caller notice",
      "help": "Record the client permission and notice for imported call data.",
      "kind": "text",
      "required": true
    }
  ]
} as const;
