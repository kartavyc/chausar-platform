// Browser-safe document-desk metadata, pinned to the validated engine definition (W6 6E4).
export const DOCUMENT_META = {
  "registration": {
    "id": "document-desk",
    "label": "Document desk",
    "serviceType": "consulting",
    "picks": [
      "document desk",
      "employee handbook",
      "hr handbook",
      "sop writing",
      "standard operating procedure",
      "detailed project report",
      "project report",
      "cma report",
      "cma data",
      "cost estimate",
      "estimate preparation",
      "thesis editing",
      "technical writing",
      "technical writer"
    ],
    "summary": "Agents draft handbooks, SOPs, project reports, estimates, thesis edits and technical documents from the client's own files; code computes every figure, and you approve and send each document.",
    "riskLevel": "medium",
    "lastReviewed": "2026-11-01"
  },
  "offers": [
    {
      "id": "handbook-sop",
      "name": "Handbooks and SOPs",
      "description": "Handbooks and SOPs",
      "pricing": "project",
      "unit": "per document",
      "price": "owner-sets",
      "stages": [
        "draft"
      ],
      "workflow": [
        "sources",
        "brief",
        "draft",
        "figures",
        "review",
        "export",
        "send"
      ],
      "includes": [
        "An employee handbook or a standard operating procedure from the client policies"
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
      "id": "project-report",
      "name": "Project reports (DPR or CMA)",
      "description": "Project reports (DPR or CMA)",
      "pricing": "project",
      "unit": "per document",
      "price": "owner-sets",
      "stages": [
        "draft"
      ],
      "workflow": [
        "sources",
        "brief",
        "draft",
        "figures",
        "review",
        "export",
        "send"
      ],
      "includes": [
        "A project report with a figures table computed by code"
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
      "id": "estimate",
      "name": "Estimates",
      "description": "Estimates",
      "pricing": "project",
      "unit": "per document",
      "price": "owner-sets",
      "stages": [
        "draft"
      ],
      "workflow": [
        "sources",
        "brief",
        "draft",
        "figures",
        "review",
        "export",
        "send"
      ],
      "includes": [
        "An estimate with quantities and amounts computed by code"
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
      "id": "thesis-edit",
      "name": "Thesis editing",
      "description": "Thesis editing",
      "pricing": "project",
      "unit": "per document",
      "price": "owner-sets",
      "stages": [
        "draft"
      ],
      "workflow": [
        "sources",
        "brief",
        "draft",
        "figures",
        "review",
        "export",
        "send"
      ],
      "includes": [
        "An edited thesis chapter with the changes and queries listed"
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
      "id": "technical-writing",
      "name": "Technical writing",
      "description": "Technical writing",
      "pricing": "project",
      "unit": "per document",
      "price": "owner-sets",
      "stages": [
        "draft"
      ],
      "workflow": [
        "sources",
        "brief",
        "draft",
        "figures",
        "review",
        "export",
        "send"
      ],
      "includes": [
        "A manual, guide or reference from the client material"
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
