// Original local caption capability. Stock speech uses the existing google-tts entry; cloning stays planned.
import type {CatalogueEntry} from '../catalogue.ts';
export const TRANSLATION_STUDIO_CATALOGUE:readonly CatalogueEntry[]=Object.freeze([
  {
    "id": "local-live-captions",
    "name": "Local live captions",
    "category": "docs-ops",
    "auth": "Owner host permission and installed whisper.cpp",
    "regions": [
      "india",
      "global"
    ],
    "regionNote": null,
    "note": "Desktop microphone audio is transcribed locally. Saving is off until the owner enables it. No remote fallback.",
    "vendorUrl": null,
    "targets": [
      "write"
    ]
  }
]);
