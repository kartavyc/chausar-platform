// Browser-safe article metadata, pinned to its real kit definition.
export const ARTICLE_META = {
  "registration": {
    "id": "podcast-to-article",
    "label": "Podcast to articles",
    "serviceType": "content",
    "picks": [
      "podcast to article",
      "podcast to blog",
      "video to article",
      "episode to blog post",
      "show notes service"
    ],
    "summary": "Agents turn each episode into an article, show notes and a newsletter blurb, every sentence tied to the transcript; you pick the angle and approve the article.",
    "riskLevel": "medium",
    "lastReviewed": "2026-10-28"
  },
  "offers": [
    {
      "id": "article-per-episode",
      "name": "Article per episode",
      "description": "A source-cited article with show notes and a newsletter blurb.",
      "pricing": "project",
      "unit": "per episode",
      "intake": [
        "transcript",
        "media",
        "host",
        "guests",
        "language",
        "guestConsent"
      ],
      "rights": [
        "own-footage",
        "licence"
      ]
    },
    {
      "id": "show-notes",
      "name": "Show notes",
      "description": "Add show notes from the same episode ledger.",
      "pricing": "project",
      "unit": "per episode",
      "intake": [
        "transcript",
        "media",
        "host",
        "guests",
        "language",
        "guestConsent"
      ],
      "rights": [
        "own-footage",
        "licence"
      ]
    },
    {
      "id": "newsletter-blurb",
      "name": "Newsletter blurb",
      "description": "Add a newsletter blurb from the same episode ledger.",
      "pricing": "project",
      "unit": "per episode",
      "intake": [
        "transcript",
        "media",
        "host",
        "guests",
        "language",
        "guestConsent"
      ],
      "rights": [
        "own-footage",
        "licence"
      ]
    }
  ],
  "intakeFields": [
    {
      "id": "transcript",
      "label": "Episode transcript",
      "help": "Upload an SRT, VTT or TXT transcript.",
      "kind": "file",
      "required": false
    },
    {
      "id": "media",
      "label": "Episode media",
      "help": "Upload audio, or choose a local video path in the episode desk.",
      "kind": "file",
      "required": false
    },
    {
      "id": "host",
      "label": "Host name",
      "help": "The actual host in the episode.",
      "kind": "text",
      "required": true
    },
    {
      "id": "guests",
      "label": "Guest names",
      "help": "Name each guest as the transcript identifies them.",
      "kind": "list",
      "required": true
    },
    {
      "id": "language",
      "label": "Article language",
      "help": "Choose the English or Hindi house sample.",
      "kind": "choice",
      "options": [
        "en",
        "hi"
      ],
      "required": true
    },
    {
      "id": "guestConsent",
      "label": "Guest quotation permission",
      "help": "The client confirms permission to quote these guests.",
      "kind": "yes-no",
      "required": true
    }
  ]
} as const;
