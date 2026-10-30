// Native R2 rule view and exact dated recheck adapter; fresh and stale parity are tested.
const CURRENT={
  "playbook": {
    "id": "data-entry-desk",
    "label": "Data entry desk",
    "riskLevel": "high",
    "lastReviewed": "2026-10-29"
  },
  "rules": [
    {
      "id": "forms-client-permission",
      "platform": "India",
      "rule": "Access the client system only with permission. Keep written permission and a revocable staff login before opening the browser.",
      "checkedOn": "2026-10-29",
      "stale": false,
      "usedBy": [
        "site-check",
        "fill",
        "hold"
      ],
      "limitations": [
        "A lawyer must confirm the permission and client data-use workflow. Government and seller portals remain refused."
      ],
      "source": {
        "title": "Information Technology Act, section 43",
        "url": "https://www.indiacode.nic.in/bitstream/123456789/13116/1/it_act_2000_updated.pdf"
      },
      "sources": [
        {
          "title": "Information Technology Act, section 43",
          "url": "https://www.indiacode.nic.in/bitstream/123456789/13116/1/it_act_2000_updated.pdf"
        }
      ],
      "line": "Current. Read the permission section in the official Act. Written proof and a revocable staff login are conservative house requirements. A lawyer has not confirmed it yet, so it works in practice runs only."
    },
    {
      "id": "forms-restricted-portals",
      "platform": "house",
      "rule": "Never use this browser on government portals or Amazon, Flipkart or Meesho seller portals.",
      "checkedOn": "2026-10-29",
      "stale": false,
      "usedBy": [
        "site-check"
      ],
      "limitations": [
        "The owner uses the portal manually outside this workflow."
      ],
      "source": null,
      "sources": [
        {
          "title": "Chausar's own rule",
          "url": ""
        }
      ],
      "line": "Current. Conservative Chausar boundary, not a claim that a portal authorizes automated access."
    }
  ],
  "summary": "2 current, 0 to recheck.",
  "recipes": [
    {
      "id": "source-before-submit",
      "name": "Check before each submit",
      "whenToUse": "For client data entry",
      "steps": [
        {
          "do": "Review source and current form together.",
          "why": "Page changes invalidate earlier targets."
        }
      ],
      "howToRead": "Keep differences visible and inspect them manually.",
      "mistakes": [
        "Retrying an uncertain submit",
        "Calling a filled field a saved record"
      ]
    }
  ],
  "boundaries": [
    {
      "evidence": "Current source and saved response",
      "canSay": "These exact fields match or differ.",
      "cannotSay": "Every client record was saved without a verified identity."
    }
  ]
};
export function formsRules(today:string){const out=structuredClone(CURRENT);for(const rule of out.rules){const age=Math.floor((Date.parse(today+'T00:00:00Z')-Date.parse(rule.checkedOn+'T00:00:00Z'))/86400000);rule.stale=age>90;if(rule.stale)rule.line=rule.id==='forms-client-permission'?'Client system permission was checked '+age+' days ago, on '+rule.checkedOn+'. Check it again on its source page before relying on it. A lawyer has not confirmed it yet, so it works in practice runs only.':'Restricted portals was checked '+age+' days ago, on '+rule.checkedOn+'. Check it again before relying on it.';}const stale=out.rules.filter(r=>r.stale).length;out.summary=(out.rules.length-stale)+' current, '+stale+' to recheck.';return out;}
