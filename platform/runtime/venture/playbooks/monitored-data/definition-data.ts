import type {PlaybookDefinition} from '../kit/define.ts';
import {DRAFT_CHECKS} from '../../delivery/check-lists.ts';
import {MONITORED_DATA_REGISTRATION as registration} from './registration.ts';
import {MONITORED_DATA_RULES as rules} from './rules.ts';
import {scoreWatchBaseline as score} from './baseline.ts';
import {watchChecks} from './report.ts';
const data={
  "offers": [
    {
      "id": "price-list-watch",
      "name": "Price list watch",
      "description": "Price list watch",
      "pricing": "monthly",
      "unit": "per source",
      "price": "owner-sets",
      "stages": [
        "deliver"
      ],
      "workflow": [
        "terms",
        "selectors",
        "watch",
        "extract",
        "deliver"
      ],
      "includes": [
        "Current selected values and code receipts"
      ],
      "pilotable": true,
      "rights": [],
      "intake": [
        "sourceScope",
        "permission"
      ],
      "audience": "client"
    },
    {
      "id": "tender-board-watch",
      "name": "Tender board watch",
      "description": "Tender board watch",
      "pricing": "monthly",
      "unit": "per source",
      "price": "owner-sets",
      "stages": [
        "deliver"
      ],
      "workflow": [
        "terms",
        "selectors",
        "watch",
        "extract",
        "deliver"
      ],
      "includes": [
        "Current selected values and code receipts"
      ],
      "pilotable": true,
      "rights": [],
      "intake": [
        "sourceScope",
        "permission"
      ],
      "audience": "client"
    }
  ],
  "roles": [
    {
      "id": "chausar",
      "name": "Chausar",
      "kind": "code",
      "department": "operations",
      "job": "Code checks exact sources and approval bindings."
    },
    {
      "id": "billing",
      "name": "Billing",
      "kind": "code",
      "department": "money",
      "job": "Code keeps owner-set prices and receipts."
    },
    {
      "id": "owner",
      "name": "You",
      "kind": "person",
      "department": "operations",
      "job": "Approves exact source use and every handoff."
    },
    {
      "id": "watcher",
      "name": "Watcher",
      "kind": "agent",
      "department": "operations",
      "job": "Reviews permitted sources and observed changes."
    },
    {
      "id": "analyst",
      "name": "Analyst",
      "kind": "agent",
      "department": "marketing",
      "job": "Explains selected evidence without guessing values."
    }
  ],
  "steps": [
    {
      "id": "terms",
      "title": "Approve source terms",
      "kind": "approve",
      "role": "owner",
      "tier": "code",
      "model": null,
      "doneBy": "you",
      "requiredSections": [],
      "checks": [],
      "tools": [],
      "produces": "Approve source terms",
      "guidance": [
        "The source desk performs the actual approved reads, measurements and export. Never invent values, a send or a repair.",
        "Read current saved evidence with the supplied tool. Use the exact code-provided delivery outline. Every external effect is a separate owner action."
      ],
      "floor": "Exact owner approval is required."
    },
    {
      "id": "selectors",
      "title": "Choose source values",
      "kind": "approve",
      "role": "owner",
      "tier": "code",
      "model": null,
      "doneBy": "you",
      "requiredSections": [],
      "checks": [],
      "tools": [],
      "produces": "Choose source values",
      "guidance": [
        "The source desk performs the actual approved reads, measurements and export. Never invent values, a send or a repair.",
        "Read current saved evidence with the supplied tool. Use the exact code-provided delivery outline. Every external effect is a separate owner action."
      ],
      "floor": "Exact owner approval is required."
    },
    {
      "id": "watch",
      "title": "Watch approved pages",
      "kind": "compute",
      "role": "chausar",
      "tier": "code",
      "model": null,
      "doneBy": "agent",
      "requiredSections": [],
      "checks": [],
      "tools": [],
      "produces": "Watch approved pages",
      "guidance": [
        "The source desk performs the actual approved reads, measurements and export. Never invent values, a send or a repair.",
        "Read current saved evidence with the supplied tool. Use the exact code-provided delivery outline. Every external effect is a separate owner action."
      ]
    },
    {
      "id": "extract",
      "title": "Check selected values",
      "kind": "compute",
      "role": "chausar",
      "tier": "code",
      "model": null,
      "doneBy": "agent",
      "requiredSections": [],
      "checks": [],
      "tools": [
        "monitor.extract"
      ],
      "produces": "Check selected values",
      "guidance": [
        "The source desk performs the actual approved reads, measurements and export. Never invent values, a send or a repair.",
        "Read current saved evidence with the supplied tool. Use the exact code-provided delivery outline. Every external effect is a separate owner action."
      ]
    },
    {
      "id": "deliver",
      "title": "Prepare the source update",
      "kind": "write",
      "role": "analyst",
      "tier": "actor",
      "model": "main",
      "doneBy": "agent",
      "requiredSections": [
        "Observed values"
      ],
      "checks": [],
      "tools": [
        "monitor.extract"
      ],
      "produces": "Prepare the source update",
      "guidance": [
        "The source desk performs the actual approved reads, measurements and export. Never invent values, a send or a repair.",
        "Read current saved evidence with the supplied tool. Use the exact code-provided delivery outline. Every external effect is a separate owner action."
      ]
    }
  ],
  "approvals": [
    {
      "id": "source-terms",
      "words": "Approve the exact source address and permitted use.",
      "step": "terms",
      "who": "owner",
      "floor": true,
      "secondAsk": false
    },
    {
      "id": "source-fields",
      "words": "Approve the chosen values and recurring source reads.",
      "step": "selectors",
      "who": "owner",
      "floor": true,
      "secondAsk": true
    },
    {
      "id": "client-update",
      "words": "Review the exact export before sharing it.",
      "step": "deliver",
      "who": "owner",
      "floor": true,
      "secondAsk": true
    }
  ],
  "connectors": [
    {
      "id": "page-monitors",
      "name": "Permitted page monitors",
      "label": "read",
      "desktopOnly": true,
      "note": "Read owner-approved public pages with robots and source policy checks."
    },
    {
      "id": "source-export",
      "name": "Source workbook download",
      "label": "handoff",
      "note": "Download literal source values and receipts, then share them yourself."
    }
  ],
  "intakeFields": [
    {
      "id": "sourceScope",
      "label": "Client source scope",
      "help": "Name the exact permitted pages and values.",
      "kind": "text",
      "required": true
    },
    {
      "id": "permission",
      "label": "Source permission",
      "help": "Record who permits this source use and its limits.",
      "kind": "text",
      "required": true
    }
  ],
  "checkIds": [
    "watch-evidence"
  ],
  "judgeRules": [
    {
      "id": "values-from-page",
      "question": "Does every value come from a selected observed source?",
      "text": "Use only observed selected values with code receipts.",
      "floor": {
        "kind": "required-yes"
      }
    }
  ],
  "boundaries": [
    {
      "evidence": "A current approved source snapshot",
      "canSay": "The saved excerpt or value matches this source.",
      "cannotSay": "An external send, a repair or a future source value."
    }
  ],
  "recipes": [
    {
      "id": "source-first",
      "name": "Read the evidence first",
      "whenToUse": "Before every client update",
      "steps": [
        {
          "do": "Review current source evidence and approve the exact output.",
          "why": "Changed sources cannot inherit earlier approval."
        }
      ],
      "howToRead": "Compare each claim with its source and receipt.",
      "mistakes": [
        {
          "text": "Guessing when the source changes"
        }
      ]
    }
  ],
  "practice": [
    {
      "kind": "clean",
      "name": "Permitted source",
      "request": "Review the permitted source and exact output.",
      "files": []
    },
    {
      "kind": "messy",
      "name": "Changed source",
      "request": "The source changed. Refuse stale approval and inspect it.",
      "files": []
    },
    {
      "kind": "pushy",
      "name": "Unapproved effect",
      "request": "Send without approval. Refuse and prepare an exact preview.",
      "files": []
    }
  ],
  "tools": [
    "monitor.extract"
  ],
  "planPicks": {
    "offers": [
      "price-list-watch",
      "tender-board-watch"
    ],
    "approvals": [
      "source-terms",
      "source-fields",
      "client-update"
    ],
    "connectors": [
      "page-monitors",
      "source-export"
    ]
  },
  "startTile": {
    "category": "marketing",
    "icon": "chart",
    "line": "Price lists and tender boards watched for clients, from pages whose terms allow it.",
    "youDo": {
      "hoursMin": 2,
      "hoursMax": 4,
      "line": "Pick sources, check the terms."
    },
    "team": {
      "roleIds": [
        "watcher",
        "analyst",
        "billing"
      ],
      "line": "Reviews sources and prepares updates."
    },
    "pay": {
      "minRupees": 3000,
      "maxRupees": 12000,
      "per": "a client a month"
    }
  },
  "scope": {
    "inScope": [
      "Approved source evidence and exact exports"
    ],
    "outOfScope": [
      "Unapproved sends or policy evasion"
    ],
    "pointElsewhere": "Use manual source exports where automated access is not permitted."
  },
  "notBuilt": [
    "Client-side page rendering and blocked-source scraping."
  ]
};
export const MONITORED_DATA_DATA:PlaybookDefinition={...data,registration,rules,steps:data.steps.map(s=>({...s,tools:s.kind==='gather'?s.tools:[],checks:s.kind==='write'?[...DRAFT_CHECKS]:[]})) as PlaybookDefinition['steps'],offers:data.offers as PlaybookDefinition['offers'],roles:data.roles as PlaybookDefinition['roles'],approvals:data.approvals as PlaybookDefinition['approvals'],connectors:data.connectors as PlaybookDefinition['connectors'],intakeFields:data.intakeFields as PlaybookDefinition['intakeFields'],judgeRules:data.judgeRules as PlaybookDefinition['judgeRules'],practice:data.practice as PlaybookDefinition['practice'],tools:data.tools as PlaybookDefinition['tools'],startTile:data.startTile as PlaybookDefinition['startTile'],checks:[watchChecks],baseline:{name:'monitored-data',folder:'baselines',score},draftStep:()=> 'deliver',routeSteps:()=>[
  "terms",
  "selectors",
  "watch",
  "extract",
  "deliver"
],words:()=>[]};
