// Browser-safe narration metadata, pinned by engine parity tests.
export const NARRATION_META = {
  "registration": {
    "id": "narration-studio",
    "label": "Narration and audiobooks",
    "serviceType": "studio",
    "picks": [
      "audiobook",
      "narration service",
      "voice over service",
      "narrated lessons",
      "explainer reel"
    ],
    "summary": "Make disclosed narration from a manuscript or exact source quotes. You approve each paid voice call and listen before delivery.",
    "riskLevel": "medium",
    "lastReviewed": "2026-10-29"
  },
  "offers": [
    {
      "id": "audiobook",
      "name": "Audiobook",
      "description": "Audiobook",
      "pricing": "project",
      "unit": "per finished hour",
      "intake": [
        "manuscript",
        "rights",
        "voice",
        "languages",
        "distribution",
        "private"
      ],
      "rights": [
        "own-footage",
        "licence"
      ]
    },
    {
      "id": "narrated-lessons",
      "name": "Narrated lessons",
      "description": "Narrated lessons",
      "pricing": "project",
      "unit": "per finished hour",
      "intake": [
        "manuscript",
        "rights",
        "voice",
        "languages",
        "distribution",
        "private"
      ],
      "rights": [
        "own-footage",
        "licence"
      ]
    },
    {
      "id": "explainer-reel",
      "name": "Explainer reel",
      "description": "Explainer reel",
      "pricing": "project",
      "unit": "per reel",
      "intake": [
        "manuscript",
        "rights",
        "voice",
        "languages",
        "distribution",
        "private"
      ],
      "rights": [
        "own-footage",
        "licence"
      ]
    }
  ],
  "intakeFields": [
    {
      "id": "manuscript",
      "label": "Manuscript",
      "help": "Attach text, Markdown or Word. An explainer can use an approved public source instead.",
      "kind": "file",
      "required": false
    },
    {
      "id": "rights",
      "label": "Manuscript rights",
      "help": "Record authorship or a written narration licence.",
      "kind": "rights",
      "required": true
    },
    {
      "id": "voice",
      "label": "Voice choice",
      "help": "Choose licensed stock speech. Cloning is not available.",
      "kind": "choice",
      "options": [
        "Licensed stock voice"
      ],
      "required": true
    },
    {
      "id": "languages",
      "label": "Languages",
      "help": "Choose English or Hindi in the narration desk.",
      "kind": "list",
      "required": true
    },
    {
      "id": "distribution",
      "label": "Distribution",
      "help": "Client delivery or disclosed Spotify upload. Other routes need specific authorization.",
      "kind": "choice",
      "options": [
        "Client delivery",
        "Spotify"
      ],
      "required": true
    },
    {
      "id": "private",
      "label": "Private manuscript",
      "help": "Private text stays local until qualified local synthesis and model routes are available.",
      "kind": "yes-no",
      "required": true
    }
  ]
} as const;
