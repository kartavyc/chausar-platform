// Browser-safe signoff-desk metadata, pinned to the validated engine definition (W6 6E5).
export const SIGNOFF_META = {
  "registration": {
    "id": "signoff-desk",
    "label": "Sign-off desk",
    "serviceType": "licensed",
    "picks": [
      "sign-off desk",
      "signoff desk",
      "advocate",
      "law practice",
      "legal drafting",
      "doctor practice",
      "doctor follow-up",
      "patient follow-up",
      "clinic follow-up",
      "financial planner",
      "mutual fund distributor",
      "company secretary",
      "secretarial work"
    ],
    "summary": "Agents prepare regulated papers; a named licensed professional signs each one before it reaches a client, and tools the regulator forbids stay off.",
    "riskLevel": "high",
    "lastReviewed": "2026-11-01"
  },
  "offers": [
    {
      "id": "legal-drafting",
      "name": "Legal drafts signed by your advocate",
      "description": "Legal drafts signed by your advocate",
      "pricing": "project",
      "unit": "per paper",
      "price": "owner-sets",
      "stages": [
        "draft"
      ],
      "workflow": [
        "notes",
        "draft",
        "check",
        "signoff",
        "send"
      ],
      "includes": [
        "A draft notice, agreement or reply your advocate signs"
      ],
      "pilotable": true,
      "rights": [],
      "intake": [
        "scope",
        "deliverable",
        "deadline"
      ],
      "audience": "client"
    },
    {
      "id": "clinic-follow-up",
      "name": "Patient follow-ups signed by your doctor",
      "description": "Patient follow-ups signed by your doctor",
      "pricing": "project",
      "unit": "per paper",
      "price": "owner-sets",
      "stages": [
        "draft"
      ],
      "workflow": [
        "notes",
        "draft",
        "check",
        "signoff",
        "send"
      ],
      "includes": [
        "Appointment and follow-up messages your doctor signs"
      ],
      "pilotable": false,
      "rights": [],
      "intake": [
        "scope",
        "deliverable",
        "deadline"
      ],
      "audience": "client"
    },
    {
      "id": "review-pack",
      "name": "Review packs signed by your adviser",
      "description": "Review packs signed by your adviser",
      "pricing": "project",
      "unit": "per paper",
      "price": "owner-sets",
      "stages": [
        "draft"
      ],
      "workflow": [
        "notes",
        "draft",
        "check",
        "signoff",
        "send"
      ],
      "includes": [
        "A portfolio review pack your SEBI-registered adviser signs"
      ],
      "pilotable": false,
      "rights": [],
      "intake": [
        "scope",
        "deliverable",
        "deadline"
      ],
      "audience": "client"
    },
    {
      "id": "secretarial-papers",
      "name": "Secretarial papers signed by your company secretary",
      "description": "Secretarial papers signed by your company secretary",
      "pricing": "project",
      "unit": "per paper",
      "price": "owner-sets",
      "stages": [
        "draft"
      ],
      "workflow": [
        "notes",
        "draft",
        "check",
        "signoff",
        "send"
      ],
      "includes": [
        "Minutes, resolutions and filing drafts your company secretary signs"
      ],
      "pilotable": false,
      "rights": [],
      "intake": [
        "scope",
        "deliverable",
        "deadline"
      ],
      "audience": "client"
    },
    {
      "id": "tax-papers",
      "name": "Tax and payroll papers signed by a CA",
      "description": "Tax and payroll papers signed by a CA",
      "pricing": "project",
      "unit": "per paper",
      "price": "owner-sets",
      "stages": [
        "draft"
      ],
      "workflow": [
        "notes",
        "draft",
        "check",
        "signoff",
        "send"
      ],
      "includes": [
        "Return and payroll papers a chartered accountant signs"
      ],
      "pilotable": false,
      "rights": [],
      "intake": [
        "scope",
        "deliverable",
        "deadline"
      ],
      "audience": "client"
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
      "required": false
    }
  ]
} as const;
