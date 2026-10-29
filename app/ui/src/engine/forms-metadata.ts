// Derived source metadata, checked against the native R2 definition.
export const FORMS_META = {
  "registration": {
    "id": "data-entry-desk",
    "label": "Data entry desk",
    "serviceType": "other",
    "picks": [
      "data entry service",
      "data entry for",
      "back office data entry",
      "form filling service"
    ],
    "summary": "Agents propose source mappings for client systems on this computer; you approve every fill and submit, and code compares saved records.",
    "riskLevel": "high",
    "lastReviewed": "2026-10-29"
  },
  "offers": [
    {
      "id": "data-entry-monthly",
      "name": "Monthly data entry",
      "description": "Monthly data entry",
      "pricing": "monthly",
      "unit": "per agreed volume band",
      "intake": [
        "source-file",
        "record-id-column",
        "site-url",
        "permission-file",
        "data-consent"
      ],
      "rights": []
    },
    {
      "id": "backlog-project",
      "name": "Backlog entry project",
      "description": "Backlog entry project",
      "pricing": "project",
      "unit": "per client project",
      "intake": [
        "source-file",
        "record-id-column",
        "site-url",
        "permission-file",
        "data-consent"
      ],
      "rights": []
    }
  ],
  "intakeFields": [
    {
      "id": "source-file",
      "label": "Client CSV",
      "help": "Upload only the agreed source records, with no passwords or access codes.",
      "kind": "file",
      "required": true
    },
    {
      "id": "record-id-column",
      "label": "Unique client record column",
      "help": "Name the stable unique record identity column.",
      "kind": "text",
      "required": true
    },
    {
      "id": "site-url",
      "label": "Client page address",
      "help": "Use the exact permitted client page address.",
      "kind": "text",
      "required": true
    },
    {
      "id": "permission-file",
      "label": "Written permission",
      "help": "Upload permission as a text file, never the staff password.",
      "kind": "file",
      "required": true
    },
    {
      "id": "data-consent",
      "label": "Client data consent",
      "help": "Confirm consent for processing these source records.",
      "kind": "yes-no",
      "required": true
    }
  ]
} as const;
