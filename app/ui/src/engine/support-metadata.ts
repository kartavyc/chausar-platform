// Support onboarding metadata generated from the kit definition. Original Chausar data.
export const SUPPORT_DESK_META = {
  "registration": {
    "id": "support-desk",
    "label": "Support desk for small shops",
    "serviceType": "support",
    "picks": [
      "support desk",
      "customer support service",
      "customer service for shops",
      "helpdesk service",
      "support inbox",
      "ticket handling"
    ],
    "summary": "Agents sort customer mail and draft replies with sources; you approve and send every reply from the shop mailbox.",
    "riskLevel": "medium",
    "lastReviewed": "2026-10-27"
  },
  "offers": [
    {
      "id": "monthly-support",
      "name": "Monthly support",
      "description": "Customer mail and approved replies for a shop.",
      "pricing": "monthly",
      "unit": "a shop a month",
      "intake": [
        "shopHours",
        "timeZone",
        "holidays",
        "firstReplyHours",
        "resolutionHours",
        "policies",
        "blockedCustomers",
        "languages"
      ]
    },
    {
      "id": "launch-support",
      "name": "Launch support",
      "description": "Support for a launch or sale window.",
      "pricing": "project",
      "unit": "per launch",
      "intake": [
        "shopHours",
        "timeZone",
        "holidays",
        "firstReplyHours",
        "resolutionHours",
        "policies",
        "blockedCustomers",
        "languages"
      ]
    },
    {
      "id": "help-pages",
      "name": "Help pages",
      "description": "Help articles from past tickets and confirmed shop policies.",
      "pricing": "project",
      "unit": "per set",
      "intake": [
        "policies",
        "languages"
      ]
    },
    {
      "id": "support-report",
      "name": "Support report",
      "description": "A report of ticket outcomes, ratings and knowledge gaps.",
      "pricing": "monthly",
      "unit": "a shop a month",
      "intake": []
    },
    {
      "id": "ai-pass-through",
      "name": "AI spend pass through",
      "description": "Actual AI spend receipts with the markup you set.",
      "pricing": "monthly",
      "unit": "a shop a month",
      "intake": []
    }
  ],
  "intakeFields": [
    {
      "id": "shopHours",
      "label": "Shop opening hours",
      "help": "Days and local opening times; leave unset for always open.",
      "kind": "text",
      "required": false
    },
    {
      "id": "timeZone",
      "label": "Shop timezone",
      "help": "The timezone used for response targets.",
      "kind": "text",
      "required": false
    },
    {
      "id": "holidays",
      "label": "Shop holidays",
      "help": "Local dates without shop opening hours.",
      "kind": "list",
      "required": false
    },
    {
      "id": "firstReplyHours",
      "label": "First reply target",
      "help": "Business hours allowed before the first reply.",
      "kind": "text",
      "required": false
    },
    {
      "id": "resolutionHours",
      "label": "Resolution target",
      "help": "Business hours allowed for resolving the request.",
      "kind": "text",
      "required": false
    },
    {
      "id": "policies",
      "label": "Shop policies",
      "help": "The shop files that support a reply.",
      "kind": "file",
      "required": true
    },
    {
      "id": "blockedCustomers",
      "label": "Blocked customers",
      "help": "Addresses that go straight to the owner.",
      "kind": "list",
      "required": false
    },
    {
      "id": "languages",
      "label": "Customer languages",
      "help": "The languages the shop can review.",
      "kind": "list",
      "required": true
    }
  ]
} as const;
