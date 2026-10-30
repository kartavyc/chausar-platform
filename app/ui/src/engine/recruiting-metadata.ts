// Browser-safe recruiting metadata, pinned to the real kit definition.
export const RECRUITING_META = {
  "registration": {
    "id": "recruiting-desk",
    "label": "Recruiting desk",
    "serviceType": "consulting",
    "picks": [
      "recruiting",
      "recruitment agency",
      "hiring help",
      "headhunting",
      "talent sourcing",
      "resume screening",
      "placement agency"
    ],
    "summary": "Agents turn roles into clear rules and screen client resumes with quoted proof. You approve messages and decide every rejection.",
    "riskLevel": "high",
    "lastReviewed": "2026-10-28"
  },
  "offers": [
    {
      "id": "role-intake",
      "name": "Role intake",
      "description": "A public job description, private sourcing note and rules.",
      "pricing": "project",
      "unit": "per role",
      "price": "owner-sets",
      "stages": [
        "report"
      ],
      "workflow": [
        "role-intake",
        "approve-rules",
        "source",
        "screen",
        "ledger",
        "first-message",
        "approve-message",
        "send",
        "schedule",
        "approve-invite",
        "report"
      ],
      "includes": [
        "Quoted evidence and owner decisions"
      ],
      "pilotable": true,
      "rights": [],
      "intake": [
        "roleTitle",
        "location",
        "payRange",
        "hardRules",
        "mustHaves",
        "exclusions",
        "targetCompanies",
        "privacyNoticeUrl",
        "retentionDays"
      ],
      "audience": "client"
    },
    {
      "id": "shortlist",
      "name": "A reviewed shortlist",
      "description": "A batch of candidates with quoted professional evidence.",
      "pricing": "project",
      "unit": "per batch",
      "price": "owner-sets",
      "stages": [
        "report"
      ],
      "workflow": [
        "role-intake",
        "approve-rules",
        "source",
        "screen",
        "ledger",
        "first-message",
        "approve-message",
        "send",
        "schedule",
        "approve-invite",
        "report"
      ],
      "includes": [
        "Quoted evidence and owner decisions"
      ],
      "pilotable": false,
      "rights": [],
      "intake": [
        "roleTitle",
        "location",
        "payRange",
        "hardRules",
        "mustHaves",
        "exclusions",
        "targetCompanies",
        "privacyNoticeUrl",
        "retentionDays"
      ],
      "audience": "client"
    },
    {
      "id": "resume-screening",
      "name": "Resume screening",
      "description": "Ongoing screening against current approved rules.",
      "pricing": "monthly",
      "unit": "per month",
      "price": "owner-sets",
      "stages": [
        "report"
      ],
      "workflow": [
        "role-intake",
        "approve-rules",
        "source",
        "screen",
        "ledger",
        "first-message",
        "approve-message",
        "send",
        "schedule",
        "approve-invite",
        "report"
      ],
      "includes": [
        "Quoted evidence and owner decisions"
      ],
      "pilotable": false,
      "rights": [],
      "intake": [
        "roleTitle",
        "location",
        "payRange",
        "hardRules",
        "mustHaves",
        "exclusions",
        "targetCompanies",
        "privacyNoticeUrl",
        "retentionDays"
      ],
      "audience": "client"
    },
    {
      "id": "interview-scheduling",
      "name": "Interview scheduling",
      "description": "Unsent interview packs checked against a calendar export.",
      "pricing": "project",
      "unit": "per role",
      "price": "owner-sets",
      "stages": [
        "report"
      ],
      "workflow": [
        "role-intake",
        "approve-rules",
        "source",
        "screen",
        "ledger",
        "first-message",
        "approve-message",
        "send",
        "schedule",
        "approve-invite",
        "report"
      ],
      "includes": [
        "Quoted evidence and owner decisions"
      ],
      "pilotable": false,
      "rights": [],
      "intake": [
        "roleTitle",
        "location",
        "payRange",
        "hardRules",
        "mustHaves",
        "exclusions",
        "targetCompanies",
        "privacyNoticeUrl",
        "retentionDays"
      ],
      "audience": "client"
    },
    {
      "id": "success-fee",
      "name": "Success fee",
      "description": "A fixed owner-set fee after a confirmed hire. Advanced share pricing needs the offer letter.",
      "pricing": "project",
      "unit": "per confirmed hire",
      "price": "owner-sets",
      "stages": [
        "report"
      ],
      "workflow": [
        "role-intake",
        "approve-rules",
        "source",
        "screen",
        "ledger",
        "first-message",
        "approve-message",
        "send",
        "schedule",
        "approve-invite",
        "report"
      ],
      "includes": [
        "Quoted evidence and owner decisions"
      ],
      "pilotable": false,
      "rights": [],
      "intake": [
        "roleTitle",
        "location",
        "payRange",
        "hardRules",
        "mustHaves",
        "exclusions",
        "targetCompanies",
        "privacyNoticeUrl",
        "retentionDays"
      ],
      "audience": "client"
    }
  ],
  "intakeFields": [
    {
      "id": "roleTitle",
      "label": "Role title",
      "help": "The work the client needs.",
      "kind": "text",
      "required": true
    },
    {
      "id": "location",
      "label": "Work location",
      "help": "Workplace or remote scope.",
      "kind": "text",
      "required": true
    },
    {
      "id": "payRange",
      "label": "Client pay range",
      "help": "Only pay the client authorised you to share.",
      "kind": "text",
      "required": true
    },
    {
      "id": "hardRules",
      "label": "Hard rules",
      "help": "Observable job requirements.",
      "kind": "list",
      "required": true
    },
    {
      "id": "mustHaves",
      "label": "Required skills",
      "help": "Each skill and how to verify it.",
      "kind": "list",
      "required": true
    },
    {
      "id": "exclusions",
      "label": "Professional exclusions",
      "help": "Explicit professional contradictions only.",
      "kind": "list",
      "required": false
    },
    {
      "id": "targetCompanies",
      "label": "Target companies",
      "help": "Client-approved sourcing leads.",
      "kind": "list",
      "required": false
    },
    {
      "id": "privacyNoticeUrl",
      "label": "Privacy notice address",
      "help": "The client approved public notice.",
      "kind": "text",
      "required": true
    },
    {
      "id": "retentionDays",
      "label": "Retention days",
      "help": "How long records remain after the role closes.",
      "kind": "text",
      "required": true
    }
  ]
} as const;
