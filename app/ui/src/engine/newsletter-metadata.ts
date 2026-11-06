// Browser-safe newsletter metadata pinned to its validated kit.
export const NEWSLETTER_META = {
  "registration": {
    "id": "newsletter-studio",
    "label": "Newsletter service",
    "serviceType": "content",
    "picks": [
      "newsletter service",
      "newsletter for",
      "email newsletter",
      "newsletter writing",
      "run a newsletter"
    ],
    "summary": "Agents write each issue and check it before it goes; you approve every send, and the issue goes out from your own newsletter tool.",
    "riskLevel": "medium",
    "lastReviewed": "2026-10-29"
  },
  "offers": [
    {
      "id": "client-newsletter",
      "name": "Client newsletter",
      "description": "Client newsletter",
      "pricing": "monthly",
      "unit": "per client per month",
      "price": "owner-sets",
      "stages": [
        "write",
        "report"
      ],
      "workflow": [
        "gather",
        "write",
        "review",
        "approve",
        "send",
        "results",
        "report"
      ],
      "includes": [
        "Issue and source report"
      ],
      "pilotable": true,
      "rights": [],
      "intake": [
        "list",
        "consent",
        "fromAddress",
        "postalAddress",
        "tool",
        "sponsor",
        "private",
        "usRecipients"
      ],
      "audience": "public"
    },
    {
      "id": "own-newsletter",
      "name": "Own newsletter with sponsors and a paid tier",
      "description": "Own newsletter with sponsors and a paid tier",
      "pricing": "monthly",
      "unit": "per client per month",
      "price": "owner-sets",
      "stages": [
        "write",
        "report"
      ],
      "workflow": [
        "gather",
        "write",
        "review",
        "approve",
        "send",
        "results",
        "report"
      ],
      "includes": [
        "Issue and source report"
      ],
      "pilotable": false,
      "rights": [],
      "intake": [
        "list",
        "consent",
        "fromAddress",
        "postalAddress",
        "tool",
        "sponsor",
        "private",
        "usRecipients"
      ],
      "audience": "public"
    }
  ],
  "intakeFields": [
    {
      "id": "list",
      "label": "Subscriber list",
      "help": "Attach a CSV with email and firstName columns.",
      "kind": "file",
      "required": true
    },
    {
      "id": "consent",
      "label": "Subscriber permission",
      "help": "Each person agreed to this newsletter.",
      "kind": "yes-no",
      "required": true
    },
    {
      "id": "fromAddress",
      "label": "From address",
      "help": "The sender allowed by your newsletter tool.",
      "kind": "text",
      "required": true
    },
    {
      "id": "postalAddress",
      "label": "Sender postal address",
      "help": "The postal address shown in every issue.",
      "kind": "text",
      "required": true
    },
    {
      "id": "tool",
      "label": "Newsletter tool",
      "help": "The tool you use to send.",
      "kind": "text",
      "required": true
    },
    {
      "id": "sponsor",
      "label": "Sponsor",
      "help": "Name a sponsor when the issue includes paid copy.",
      "kind": "text",
      "required": false
    },
    {
      "id": "private",
      "label": "Private source notes",
      "help": "Private notes stay manual until a qualified local model is available.",
      "kind": "yes-no",
      "required": true
    },
    {
      "id": "usRecipients",
      "label": "United States recipients",
      "help": "Confirm whether this list includes United States recipients.",
      "kind": "yes-no",
      "required": true
    }
  ]
} as const;
