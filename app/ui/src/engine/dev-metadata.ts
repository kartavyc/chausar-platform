// Browser metadata pinned by venture-dev-metadata.test.ts.
export const DEV_META = {
  "registration": {
    "id": "dev-agency",
    "label": "Dev agency: maintenance, QA and security reviews",
    "serviceType": "consulting",
    "picks": [
      "maintenance retainer",
      "website maintenance",
      "qa as a service",
      "security review for",
      "code review service"
    ],
    "summary": "Your own coding tool reviews a local copy; every change waits for you, and security reviews need the code owner’s written permission.",
    "riskLevel": "high",
    "lastReviewed": "2026-10-29"
  },
  "offers": [
    {
      "id": "maintenance-retainer",
      "name": "Maintenance retainer",
      "description": "Review first, then separately approve changes after the report-only week.",
      "pricing": "monthly",
      "unit": "per month",
      "intake": [
        "source",
        "startedAt",
        "writtenPermission",
        "private"
      ],
      "rights": []
    },
    {
      "id": "qa-service",
      "name": "QA as a service",
      "description": "Review source findings and a code verdict before shipping.",
      "pricing": "project",
      "unit": "per release",
      "intake": [
        "source",
        "startedAt",
        "writtenPermission",
        "private"
      ],
      "rights": []
    },
    {
      "id": "security-review",
      "name": "Security review",
      "description": "Review a permitted source copy without live-system testing.",
      "pricing": "project",
      "unit": "per project",
      "intake": [
        "source",
        "startedAt",
        "writtenPermission",
        "private"
      ],
      "rights": []
    }
  ],
  "intakeFields": [
    {
      "id": "source",
      "label": "Source snapshot",
      "help": "Attach a text file containing the repository revision and copied source files.",
      "kind": "file",
      "required": true
    },
    {
      "id": "startedAt",
      "label": "Service started",
      "help": "Record the exact service start in the developer desk.",
      "kind": "date",
      "required": true
    },
    {
      "id": "writtenPermission",
      "label": "Written permission",
      "help": "For security work, attach the code owner permission and record its repository and window.",
      "kind": "file",
      "required": false
    },
    {
      "id": "private",
      "label": "Private source",
      "help": "Private source stays manual until a qualified local coding tool is available.",
      "kind": "yes-no",
      "required": true
    }
  ]
} as const;
