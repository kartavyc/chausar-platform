// Narration-owned local capabilities and manual distribution. Stock Google speech reuses the global google-tts catalogue entry.
import type {CatalogueEntry} from '../catalogue.ts';
export const NARRATION_STUDIO_CATALOGUE:readonly CatalogueEntry[]=Object.freeze([
  {
    "id": "narration-files",
    "name": "Narration manuscript files",
    "category": "docs-ops",
    "auth": "Owner-supplied client manuscript",
    "regions": [
      "india",
      "global"
    ],
    "regionNote": null,
    "note": "Reads current rights-cleared TXT, Markdown and bounded DOCX on the client order.",
    "vendorUrl": null,
    "targets": [
      "read"
    ]
  },
  {
    "id": "narration-local-checks",
    "name": "Local narration checks",
    "category": "docs-ops",
    "auth": "Owner-installed ffmpeg and whisper.cpp",
    "regions": [
      "india",
      "global"
    ],
    "regionNote": null,
    "note": "Measures and transcribes current audio locally. Missing tools or measurements never pass.",
    "vendorUrl": null,
    "targets": [
      "read"
    ]
  },
  {
    "id": "narration-distribution",
    "name": "Narration distributor handoff",
    "category": "docs-ops",
    "auth": "Owner distributor account",
    "regions": [
      "india",
      "global"
    ],
    "regionNote": null,
    "note": "Exports exact approved disclosed audio after named rights review. The owner uploads; technical checks do not prove acceptance.",
    "vendorUrl": null,
    "targets": [
      "handoff"
    ]
  }
]);
