// Derived browser metadata, pinned by venture-app-testing-metadata.test.ts.
export const APP_TESTING_META = {
  "registration": {
    "id": "app-testing",
    "label": "App testing and demo videos",
    "serviceType": "consulting",
    "picks": [
      "app testing service",
      "mobile app testing",
      "qa for apps",
      "demo video service",
      "product demo videos",
      "tutorial videos for software"
    ],
    "summary": "Agents test small makers' Android apps on an emulator on this computer and record software demos in a throwaway desktop; you review every finding and every video.",
    "riskLevel": "high",
    "lastReviewed": "2026-10-29"
  },
  "offers": [
    {
      "id": "app-test-round",
      "name": "App test round",
      "description": "App test round",
      "pricing": "project",
      "unit": "per build",
      "intake": [
        "description",
        "private"
      ],
      "rights": []
    },
    {
      "id": "demo-video",
      "name": "Demo video",
      "description": "Demo video",
      "pricing": "project",
      "unit": "per video",
      "intake": [
        "description",
        "testAccount",
        "private",
        "rights"
      ],
      "rights": [
        "own-footage",
        "licence"
      ]
    }
  ],
  "intakeFields": [
    {
      "id": "description",
      "label": "App or demo description",
      "help": "Describe expected behavior and the client goal.",
      "kind": "text",
      "required": true
    },
    {
      "id": "testAccount",
      "label": "Client test account",
      "help": "Confirm fictional data only. Sign in yourself in the separate viewer; never paste credentials here.",
      "kind": "yes-no",
      "required": true
    },
    {
      "id": "private",
      "label": "Private client source",
      "help": "Private descriptions and scripts need a qualified local model or voice route.",
      "kind": "yes-no",
      "required": true
    },
    {
      "id": "rights",
      "label": "Recording and narration rights",
      "help": "Record the owner or licence covering this script, captured test data and narration.",
      "kind": "rights",
      "required": true
    }
  ]
} as const;
