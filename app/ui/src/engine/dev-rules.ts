// Native developer rule view. Current and stale parity are verified by venture-dev-metadata.test.ts.
export {};
const CURRENT={
  "playbook": {
    "id": "dev-agency",
    "label": "Dev agency: maintenance, QA and security reviews",
    "riskLevel": "high",
    "lastReviewed": "2026-10-29"
  },
  "rules": [
    {
      "id": "written-security-permission",
      "platform": "India",
      "rule": "Record the code owner, repository and current written permission window before a security review. Live-system testing is excluded.",
      "checkedOn": "2026-10-29",
      "stale": false,
      "usedBy": [
        "security-permission"
      ],
      "limitations": [
        "Legal applicability is not automatically determined. Client security delivery waits for a lawyer; prepare a manual report meanwhile."
      ],
      "source": {
        "title": "Information Technology Act 2000",
        "url": "https://www.indiacode.nic.in/bitstream/123456789/13116/1/it_act_2000_updated.pdf"
      },
      "sources": [
        {
          "title": "Information Technology Act 2000",
          "url": "https://www.indiacode.nic.in/bitstream/123456789/13116/1/it_act_2000_updated.pdf"
        }
      ],
      "line": "Current. Read the permission and unauthorised-access provisions; Chausar applies a stricter local-copy-only workflow. A lawyer has not confirmed it yet, so it works in practice runs only."
    },
    {
      "id": "incident-reporting",
      "platform": "India",
      "rule": "The owner seeks qualified advice about reporting a real incident. Chausar never reports an incident automatically.",
      "checkedOn": "2026-10-29",
      "stale": false,
      "usedBy": [
        "security-permission"
      ],
      "limitations": [
        "Advice on legal reporting duties waits for professional review; contact a qualified adviser manually."
      ],
      "source": {
        "title": "CERT-In directions FAQ",
        "url": "https://www.cert-in.org.in/PDF/FAQs_on_CyberSecurityDirections_May2022.pdf"
      },
      "sources": [
        {
          "title": "CERT-In directions FAQ",
          "url": "https://www.cert-in.org.in/PDF/FAQs_on_CyberSecurityDirections_May2022.pdf"
        }
      ],
      "line": "Current. Read the official FAQ. No reporting deadline is inferred for a particular client. A lawyer has not confirmed it yet, so it works in practice runs only."
    },
    {
      "id": "source-only",
      "platform": "house",
      "rule": "Tools receive only approved copied inputs. No live target, install, exploit or automatic push is allowed.",
      "checkedOn": "2026-10-29",
      "stale": false,
      "usedBy": [
        "work",
        "checks",
        "push",
        "dev-source"
      ],
      "limitations": [
        "A completed source review is not a production or security certification."
      ],
      "source": {
        "title": "Chausar developer workflow",
        "url": "https://github.com/kartavyc/chausar-platform"
      },
      "sources": [
        {
          "title": "Chausar developer workflow",
          "url": "https://github.com/kartavyc/chausar-platform"
        }
      ],
      "line": "Current. Check current source fingerprints and exact owner approvals before dispatch."
    },
    {
      "id": "dependency-audit",
      "platform": "npm",
      "rule": "An approved audit sends copied package metadata to the npm registry. It never installs packages or runs scripts.",
      "checkedOn": "2026-10-29",
      "stale": false,
      "usedBy": [
        "checks"
      ],
      "limitations": [
        "Audit results cover reported dependency vulnerabilities, not all application risks."
      ],
      "source": {
        "title": "npm audit",
        "url": "https://docs.npmjs.com/cli/commands/npm-audit/"
      },
      "sources": [
        {
          "title": "npm audit",
          "url": "https://docs.npmjs.com/cli/commands/npm-audit/"
        }
      ],
      "line": "Current. Use the read-only audit command with copied metadata and an exact registry destination."
    }
  ],
  "summary": "4 current, 0 to recheck.",
  "recipes": [
    {
      "id": "copy-before-review",
      "name": "Review the source copy",
      "whenToUse": "Before any client source report.",
      "steps": [
        {
          "do": "Record permission and the exact revision.",
          "why": "The review must belong to the client source."
        },
        {
          "do": "Read the complete source before confirming findings.",
          "why": "An empty findings list cannot prove coverage."
        }
      ],
      "howToRead": "Check the source, the required audit and each finding separately.",
      "mistakes": [
        "Treating an incomplete review as permission to ship."
      ]
    }
  ],
  "boundaries": [
    {
      "evidence": "An exact source citation",
      "canSay": "The reviewed source contains the quoted words.",
      "cannotSay": "A safety certification or independent push confirmation."
    }
  ]
};
const TOPICS:Record<string,{topic:string;house:boolean;waiting:boolean}>={
  "written-security-permission": {
    "topic": "Permission for source security reviews",
    "house": false,
    "waiting": true
  },
  "incident-reporting": {
    "topic": "Incident reporting advice",
    "house": false,
    "waiting": true
  },
  "source-only": {
    "topic": "Copied source only",
    "house": true,
    "waiting": false
  },
  "dependency-audit": {
    "topic": "Dependency metadata disclosure",
    "house": false,
    "waiting": false
  }
};
export function devRules(today:string){const out=structuredClone(CURRENT);for(const rule of out.rules){const age=Math.floor((Date.parse(today+'T00:00:00Z')-Date.parse(rule.checkedOn+'T00:00:00Z'))/86400000);rule.stale=age>90;if(rule.stale){const meta=TOPICS[rule.id]!;rule.line=meta.topic+' was checked '+age+' days ago, on '+rule.checkedOn+'. Check it again'+(meta.house?'':' on its source page')+' before relying on it.'+(meta.waiting?' A lawyer has not confirmed it yet, so it works in practice runs only.':'');}}const stale=out.rules.filter(r=>r.stale).length;out.summary=(out.rules.length-stale)+' current, '+stale+' to recheck.';return out;}
