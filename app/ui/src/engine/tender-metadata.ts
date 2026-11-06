// Browser-safe tender metadata, pinned to the validated engine definition.
export const TENDER_META = {
  "registration": {
    "id": "tender-desk",
    "label": "Tender and proposal desk",
    "serviceType": "consulting",
    "picks": [
      "tender",
      "bid writing",
      "rfp response",
      "proposal writing",
      "gem bid",
      "government tender"
    ],
    "summary": "Agents draft RFP answers from client documents and prepare an export pack. You write prices, approve answers and submit the bid.",
    "riskLevel": "medium",
    "lastReviewed": "2026-10-29"
  },
  "offers": [
    {
      "id": "bid-response",
      "name": "Bid response",
      "description": "Bid response",
      "pricing": "project",
      "unit": "per bid",
      "price": "owner-sets",
      "stages": [
        "draft"
      ],
      "workflow": [
        "bucket",
        "import",
        "questions",
        "assign",
        "draft",
        "ground",
        "approve",
        "export",
        "submit"
      ],
      "includes": [
        "Tender response pack"
      ],
      "pilotable": true,
      "rights": [],
      "intake": [
        "rfpText",
        "rfp",
        "issuerWorkbook",
        "deadline",
        "portal",
        "documents",
        "private"
      ],
      "audience": "client"
    },
    {
      "id": "documentation-bucket",
      "name": "Client document bucket",
      "description": "Client document bucket",
      "pricing": "project",
      "unit": "per bid",
      "price": "owner-sets",
      "stages": [
        "draft"
      ],
      "workflow": [
        "bucket",
        "import",
        "questions",
        "assign",
        "draft",
        "ground",
        "approve",
        "export",
        "submit"
      ],
      "includes": [
        "Tender response pack"
      ],
      "pilotable": false,
      "rights": [],
      "intake": [
        "rfpText",
        "rfp",
        "issuerWorkbook",
        "deadline",
        "portal",
        "documents",
        "private"
      ],
      "audience": "client"
    },
    {
      "id": "compliance-matrix",
      "name": "Compliance matrix",
      "description": "Compliance matrix",
      "pricing": "project",
      "unit": "per bid",
      "price": "owner-sets",
      "stages": [
        "draft"
      ],
      "workflow": [
        "bucket",
        "import",
        "questions",
        "assign",
        "draft",
        "ground",
        "approve",
        "export",
        "submit"
      ],
      "includes": [
        "Tender response pack"
      ],
      "pilotable": false,
      "rights": [],
      "intake": [
        "rfpText",
        "rfp",
        "issuerWorkbook",
        "deadline",
        "portal",
        "documents",
        "private"
      ],
      "audience": "client"
    }
  ],
  "intakeFields": [
    {
      "id": "rfpText",
      "label": "RFP text",
      "help": "Paste one question per line, or attach an RFP file instead.",
      "kind": "text",
      "required": false
    },
    {
      "id": "rfp",
      "label": "RFP file",
      "help": "Attach the source questions. A spreadsheet needs a column map.",
      "kind": "file",
      "required": false
    },
    {
      "id": "issuerWorkbook",
      "label": "Issuer workbook",
      "help": "Attach the workbook whose answer cells should be filled.",
      "kind": "file",
      "required": false
    },
    {
      "id": "deadline",
      "label": "Deadline",
      "help": "The deadline shown by the issuer.",
      "kind": "date",
      "required": true
    },
    {
      "id": "portal",
      "label": "Submission route",
      "help": "You submit the bid through this route.",
      "kind": "choice",
      "required": true,
      "options": [
        "GeM",
        "CPPP",
        "State portal",
        "Email"
      ]
    },
    {
      "id": "documents",
      "label": "Client documents",
      "help": "Attach client evidence separately from the RFP.",
      "kind": "list",
      "required": true
    },
    {
      "id": "private",
      "label": "Private client documents",
      "help": "Private documents stay manual until a qualified local model is available.",
      "kind": "yes-no",
      "required": true
    }
  ]
} as const;
