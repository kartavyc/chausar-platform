// Browser career metadata, pinned to native contracts by venture-career-metadata.test.ts.
export const CAREER_META = {
  "registration": {
    "id": "job-search-desk",
    "label": "Job-search and career desk",
    "serviceType": "consulting",
    "picks": [
      "job search help",
      "career coach",
      "career coaching",
      "resume writing",
      "cv writing",
      "interview prep",
      "job hunt"
    ],
    "summary": "Agents prepare sourced shortlists, resumes and outreach drafts. You approve every claim and pack. The client sends and applies.",
    "riskLevel": "high",
    "lastReviewed": "2026-10-29"
  },
  "offers": [
    {
      "id": "monthly-job-search",
      "name": "Monthly job search",
      "description": "Keep an approved search moving with sourced listings and reviewed packs.",
      "pricing": "monthly",
      "unit": "a client a month",
      "intake": [
        "targetRoles",
        "locations",
        "salaryFloor",
        "facts",
        "links",
        "languages"
      ],
      "rights": []
    },
    {
      "id": "interview-prep-pack",
      "name": "Interview preparation pack",
      "description": "Prepare questions and examples from confirmed client facts.",
      "pricing": "project",
      "unit": "per interview round",
      "intake": [
        "targetRoles",
        "locations",
        "salaryFloor",
        "facts",
        "links",
        "languages"
      ],
      "rights": []
    },
    {
      "id": "job-title-audit",
      "name": "Job title audit",
      "description": "Review target titles against the client evidence.",
      "pricing": "project",
      "unit": "per review",
      "intake": [
        "targetRoles",
        "locations",
        "salaryFloor",
        "facts",
        "links",
        "languages"
      ],
      "rights": []
    },
    {
      "id": "profile-and-tailoring",
      "name": "Profile and tailoring",
      "description": "Prepare a role-specific resume and cover letter with approved claims.",
      "pricing": "project",
      "unit": "per role",
      "intake": [
        "targetRoles",
        "locations",
        "salaryFloor",
        "facts",
        "links",
        "languages"
      ],
      "rights": []
    },
    {
      "id": "weekly-shortlist",
      "name": "Weekly shortlist",
      "description": "Show matched listings, coverage and reasons for dropping others.",
      "pricing": "monthly",
      "unit": "a client a month",
      "intake": [
        "targetRoles",
        "locations",
        "salaryFloor",
        "facts",
        "links",
        "languages"
      ],
      "rights": []
    },
    {
      "id": "career-coaching",
      "name": "Career coaching",
      "description": "Prepare positioning, scored targets and a paid pilot proposal.",
      "pricing": "project",
      "unit": "per coaching pack",
      "intake": [
        "targetRoles",
        "locations",
        "salaryFloor",
        "facts",
        "links",
        "languages"
      ],
      "rights": []
    }
  ],
  "intakeFields": [
    {
      "id": "targetRoles",
      "label": "Target roles",
      "help": "List the roles the client wants.",
      "kind": "list",
      "required": true
    },
    {
      "id": "locations",
      "label": "Locations",
      "help": "List acceptable locations or remote work.",
      "kind": "list",
      "required": true
    },
    {
      "id": "salaryFloor",
      "label": "Salary expectation",
      "help": "Record the client words without estimating pay.",
      "kind": "text",
      "required": false
    },
    {
      "id": "facts",
      "label": "Client facts",
      "help": "Paste facts or name the supplied evidence file. Approve facts in the desk.",
      "kind": "text",
      "required": true
    },
    {
      "id": "links",
      "label": "Job links",
      "help": "Paste client-supplied links or use permitted public boards.",
      "kind": "list",
      "required": false
    },
    {
      "id": "languages",
      "label": "Languages",
      "help": "List the languages for the client pack.",
      "kind": "list",
      "required": true
    }
  ]
} as const;
