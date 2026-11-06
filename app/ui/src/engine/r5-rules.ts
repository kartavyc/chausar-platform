import type {RulesListView} from './types';
const CURRENT:Record<string,RulesListView>={
  "monitored-data": {
    "playbook": {
      "id": "monitored-data",
      "label": "Monitored data service",
      "riskLevel": "medium",
      "lastReviewed": "2026-10-29"
    },
    "rules": [
      {
        "id": "source-terms",
        "platform": "per source",
        "rule": "The owner records the terms URL and allowed use. Robots and site policy may still refuse the read.",
        "checkedOn": "2026-10-29",
        "stale": false,
        "usedBy": [
          "terms",
          "selectors",
          "watch",
          "extract"
        ],
        "limitations": [
          "A terms tick is not legal advice. The owner resolves unclear permission before enabling reads."
        ],
        "source": null,
        "sources": [
          {
            "title": "Chausar's own rule",
            "url": ""
          }
        ],
        "line": "Current. Actual terms and selector checks run on every source read."
      }
    ],
    "summary": "1 current, 0 to recheck.",
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
          "Guessing when the source changes"
        ]
      }
    ],
    "boundaries": [
      {
        "evidence": "A current approved source snapshot",
        "canSay": "The saved excerpt or value matches this source.",
        "cannotSay": "An external send, a repair or a future source value."
      }
    ]
  },
  "it-triage": {
    "playbook": {
      "id": "it-triage",
      "label": "IT triage desk",
      "riskLevel": "medium",
      "lastReviewed": "2026-10-29"
    },
    "rules": [
      {
        "id": "slack-commercial",
        "platform": "Slack",
        "rule": "Do not connect or publish until commercial distribution and workspace installation are qualified.",
        "checkedOn": "2026-10-29",
        "stale": false,
        "usedBy": [
          "post"
        ],
        "limitations": [
          "No production connection is qualified. A lawyer must confirm commercial use before live posting."
        ],
        "source": {
          "title": "Slack API terms",
          "url": "https://slack.com/terms-of-service/api"
        },
        "sources": [
          {
            "title": "Slack API terms",
            "url": "https://slack.com/terms-of-service/api"
          },
          {
            "title": "Slack Socket Mode",
            "url": "https://docs.slack.dev/apis/events-api/using-socket-mode/"
          }
        ],
        "line": "Current. Read the official API terms and Socket Mode envelope documentation. A lawyer has not confirmed it yet, so it works in practice runs only."
      },
      {
        "id": "source-not-authority",
        "platform": "house",
        "rule": "Hold secret or instructive messages and approve every exact reply.",
        "checkedOn": "2026-10-29",
        "stale": false,
        "usedBy": [
          "read",
          "summarise",
          "approve"
        ],
        "limitations": [
          "A summary is not a repair, payment or account change."
        ],
        "source": null,
        "sources": [
          {
            "title": "Chausar's own rule",
            "url": ""
          }
        ],
        "line": "Current. Source screening and exact quote checks refuse unsupported content."
      }
    ],
    "summary": "2 current, 0 to recheck.",
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
          "Guessing when the source changes"
        ]
      }
    ],
    "boundaries": [
      {
        "evidence": "A current approved source snapshot",
        "canSay": "The saved excerpt or value matches this source.",
        "cannotSay": "An external send, a repair or a future source value."
      }
    ]
  }
};
const TOPICS:Record<string,Record<string,{topic:string;house:boolean;waiting:boolean;window:number}>>={
  "monitored-data": {
    "source-terms": {
      "topic": "Dated permission for each source",
      "house": true,
      "waiting": false,
      "window": 90
    }
  },
  "it-triage": {
    "slack-commercial": {
      "topic": "Commercial Slack qualification",
      "house": false,
      "waiting": true,
      "window": 90
    },
    "source-not-authority": {
      "topic": "Channel messages are untrusted evidence",
      "house": true,
      "waiting": false,
      "window": 90
    }
  }
};
export function r5Rules(id:string,today:string):RulesListView{const out=structuredClone(CURRENT[id]!);for(const rule of out.rules){const meta=TOPICS[id]![rule.id]!,age=Math.floor((Date.parse(today+'T00:00:00Z')-Date.parse(rule.checkedOn+'T00:00:00Z'))/86400000);rule.stale=age>meta.window;if(rule.stale)rule.line=meta.topic+' was checked '+age+' days ago, on '+rule.checkedOn+'. Check it again'+(meta.house?'':' on its source page')+' before relying on it.'+(meta.waiting?' A lawyer has not confirmed it yet, so it works in practice runs only.':'');}const stale=out.rules.filter(r=>r.stale).length;out.summary=(out.rules.length-stale)+' current, '+stale+' to recheck.';return out;}
