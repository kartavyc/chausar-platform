// Native receptionist rule view. Current and stale parity are verified by venture-phone-metadata.test.ts.
export {};
const CURRENT={
  "playbook": {
    "id": "phone-receptionist",
    "label": "AI phone receptionist",
    "riskLevel": "high",
    "lastReviewed": "2026-10-29"
  },
  "rules": [
    {
      "id": "calling-law-review",
      "platform": "India",
      "rule": "A named lawyer must confirm the client notice and permitted calling setup before live calls. No promotional outbound calls.",
      "checkedOn": "2026-10-29",
      "stale": false,
      "usedBy": [
        "connect"
      ],
      "limitations": [
        "Applicability and phased commencement need a lawyer. This is not permission to call."
      ],
      "source": {
        "title": "TRAI commercial communications rules",
        "url": "https://trai.gov.in/tcccpr"
      },
      "sources": [
        {
          "title": "TRAI commercial communications rules",
          "url": "https://trai.gov.in/tcccpr"
        },
        {
          "title": "Digital Personal Data Protection Rules",
          "url": "https://www.meity.gov.in/data-protection-framework"
        }
      ],
      "line": "Current. Read the official rules and their stated commencement schedule. A lawyer has not confirmed it yet, so it works in practice runs only."
    },
    {
      "id": "india-provider-review",
      "platform": "provider",
      "rule": "Live calling needs verified owner account details, an Indian number, identity checks and an authenticated callback.",
      "checkedOn": "2026-10-29",
      "stale": false,
      "usedBy": [
        "connect"
      ],
      "limitations": [
        "Documentation is not account approval. Provider charges need the owner dated rate table."
      ],
      "source": {
        "title": "Retell supported phone numbers",
        "url": "https://docs.retellai.com/deploy/purchase-number"
      },
      "sources": [
        {
          "title": "Retell supported phone numbers",
          "url": "https://docs.retellai.com/deploy/purchase-number"
        },
        {
          "title": "Plivo India calling",
          "url": "https://docs.plivo.com/docs/voice-agents/sip-trunking/deploy/calling-in-india"
        },
        {
          "title": "Plivo Retell integration",
          "url": "https://docs.plivo.com/docs/voice-agents/sip-trunking/integration-guides/retell"
        }
      ],
      "line": "Current. Read provider pages; no owner account or number was qualified."
    },
    {
      "id": "human-decisions",
      "platform": "house",
      "rule": "Use client facts only. Disclose the AI and possible recording first. Hand bookings, callbacks, health, legal and payment requests to a person.",
      "checkedOn": "2026-10-29",
      "stale": false,
      "usedBy": [
        "script",
        "approve-script",
        "review"
      ],
      "limitations": [
        "No medical advice, legal advice, charge or booking by the agent."
      ],
      "source": null,
      "sources": [
        {
          "title": "Chausar's own rule",
          "url": ""
        }
      ],
      "line": "Current. Checked with script, price and handoff tests."
    }
  ],
  "summary": "3 current, 0 to recheck.",
  "recipes": [
    {
      "id": "review-before-call",
      "name": "Review the script before use",
      "whenToUse": "Before using a client script",
      "steps": [
        {
          "do": "Approve the facts, disclosure and human handoff.",
          "why": "The client controls the claims and prices."
        }
      ],
      "howToRead": "Open each cost receipt and follow up yourself.",
      "mistakes": [
        "Treating a callback request as a completed booking"
      ]
    }
  ],
  "boundaries": [
    {
      "evidence": "Owner-imported call export",
      "canSay": "Code priced this export using the owner dated rates.",
      "cannotSay": "Live call completion, completed bookings or a verified provider invoice."
    }
  ]
};
const TOPICS:Record<string,{topic:string;house:boolean;waiting:boolean}>={
  "calling-law-review": {
    "topic": "Caller notice and calling rules",
    "house": false,
    "waiting": true
  },
  "india-provider-review": {
    "topic": "India provider qualification",
    "house": false,
    "waiting": false
  },
  "human-decisions": {
    "topic": "A person handles sensitive requests",
    "house": true,
    "waiting": false
  }
};
export function phoneRules(today:string){const out=structuredClone(CURRENT);for(const rule of out.rules){const age=Math.floor((Date.parse(today+'T00:00:00Z')-Date.parse(rule.checkedOn+'T00:00:00Z'))/86400000);rule.stale=age>90;if(rule.stale){const meta=TOPICS[rule.id]!;rule.line=meta.topic+' was checked '+age+' days ago, on '+rule.checkedOn+'. Check it again'+(meta.house?'':' on its source page')+' before relying on it.'+(meta.waiting?' A lawyer has not confirmed it yet, so it works in practice runs only.':'');}}const stale=out.rules.filter(r=>r.stale).length;out.summary=(out.rules.length-stale)+' current, '+stale+' to recheck.';return out;}
