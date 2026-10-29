// Browser-safe website metadata, pinned to the validated engine definition.
export const WEBSITE_META = {
  "registration": {
    "id": "website-studio",
    "label": "Website builder",
    "serviceType": "studio",
    "picks": [
      "website builder",
      "website design service",
      "build websites for",
      "web design agency",
      "landing page service"
    ],
    "summary": "Agents write the brief, check what the builder made against your client requirements, and keep the site healthy; you approve every release.",
    "riskLevel": "medium",
    "lastReviewed": "2026-10-29"
  },
  "offers": [
    {
      "id": "business-site",
      "name": "Business website",
      "description": "Business website",
      "pricing": "project",
      "unit": "per site",
      "price": "owner-sets",
      "stages": [
        "brief"
      ],
      "workflow": [
        "gather",
        "brief",
        "approve-brief",
        "build",
        "requirements",
        "ui-check",
        "approve-preview",
        "preview",
        "approve-release",
        "release",
        "care"
      ],
      "includes": [
        "Requirements and UI evidence report"
      ],
      "pilotable": true,
      "rights": [],
      "intake": [
        "requirements",
        "pages",
        "forms",
        "domain",
        "repo",
        "host",
        "private"
      ],
      "audience": "client"
    },
    {
      "id": "landing-page",
      "name": "Landing page",
      "description": "Landing page",
      "pricing": "project",
      "unit": "per site",
      "price": "owner-sets",
      "stages": [
        "brief"
      ],
      "workflow": [
        "gather",
        "brief",
        "approve-brief",
        "build",
        "requirements",
        "ui-check",
        "approve-preview",
        "preview",
        "approve-release",
        "release",
        "care"
      ],
      "includes": [
        "Requirements and UI evidence report"
      ],
      "pilotable": false,
      "rights": [],
      "intake": [
        "requirements",
        "pages",
        "forms",
        "domain",
        "repo",
        "host",
        "private"
      ],
      "audience": "client"
    },
    {
      "id": "site-care",
      "name": "Website care",
      "description": "Website care",
      "pricing": "monthly",
      "unit": "per month",
      "price": "owner-sets",
      "stages": [
        "brief"
      ],
      "workflow": [
        "gather",
        "brief",
        "approve-brief",
        "build",
        "requirements",
        "ui-check",
        "approve-preview",
        "preview",
        "approve-release",
        "release",
        "care"
      ],
      "includes": [
        "Requirements and UI evidence report"
      ],
      "pilotable": false,
      "rights": [],
      "intake": [
        "requirements",
        "pages",
        "forms",
        "domain",
        "repo",
        "host",
        "private"
      ],
      "audience": "client"
    },
    {
      "id": "form-capture",
      "name": "Website form capture",
      "description": "Website form capture",
      "pricing": "project",
      "unit": "per site",
      "price": "owner-sets",
      "stages": [
        "brief"
      ],
      "workflow": [
        "gather",
        "brief",
        "approve-brief",
        "build",
        "requirements",
        "ui-check",
        "approve-preview",
        "preview",
        "approve-release",
        "release",
        "care"
      ],
      "includes": [
        "Requirements and UI evidence report"
      ],
      "pilotable": false,
      "rights": [],
      "intake": [
        "requirements",
        "pages",
        "forms",
        "domain",
        "repo",
        "host",
        "private"
      ],
      "audience": "client"
    }
  ],
  "intakeFields": [
    {
      "id": "requirements",
      "label": "Client requirements",
      "help": "Write the client brief in plain words.",
      "kind": "text",
      "required": true
    },
    {
      "id": "pages",
      "label": "Pages",
      "help": "Name the required pages.",
      "kind": "text",
      "required": true
    },
    {
      "id": "forms",
      "label": "Forms",
      "help": "Name each form and its minimum fields.",
      "kind": "text",
      "required": true
    },
    {
      "id": "domain",
      "label": "Client site address",
      "help": "Use the approved HTTPS site address.",
      "kind": "text",
      "required": true
    },
    {
      "id": "repo",
      "label": "Client repository",
      "help": "Use the GitHub repository address with a read token.",
      "kind": "text",
      "required": true
    },
    {
      "id": "host",
      "label": "Hosting service",
      "help": "Name the owner chosen hosting service.",
      "kind": "text",
      "required": true
    },
    {
      "id": "private",
      "label": "Private website source",
      "help": "Private source stays manual until a qualified local model is available.",
      "kind": "yes-no",
      "required": true
    }
  ]
} as const;
