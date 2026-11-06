// Exact serializable speech metadata, generated from the native provider and checked by parity tests.
export const SPEECH_PROVIDER_METADATA = [
  {
    "id": "google-tts",
    "name": "Google Cloud Text-to-Speech",
    "languages": [
      "en-IN",
      "hi-IN",
      "bn-IN",
      "ta-IN",
      "te-IN",
      "mr-IN",
      "gu-IN",
      "kn-IN",
      "ml-IN"
    ],
    "maxChars": 5000,
    "voices": [
      {
        "id": "hi-IN-Standard-A",
        "name": "Hindi, standard voice A",
        "language": "hi-IN",
        "licence": "Google's stock voice; its Cloud terms let you use the audio you make."
      },
      {
        "id": "en-IN-Standard-A",
        "name": "Indian English, standard voice A",
        "language": "en-IN",
        "licence": "Google's stock voice; its Cloud terms let you use the audio you make."
      }
    ],
    "price": {
      "microsPerMillionChars": "4000000",
      "checkedOn": "2026-10-29",
      "source": "https://cloud.google.com/text-to-speech/pricing"
    },
    "waitsOn": "Your Google Cloud key, with billing and Text-to-Speech enabled. Add it in the narration desk.",
    "manualPath": "Make the audio in the provider's own site or console with your account, and add the file to the order.",
    "note": "Google Standard voices. Fixture-tested v1 request; provider access and billing depend on your account. List-price quote ignores free allowances. Google does not supply an immutable model revision.",
    "label": "planned: write"
  },
  {
    "id": "sarvam-tts",
    "name": "Sarvam AI (Bulbul)",
    "languages": [
      "hi-IN",
      "en-IN",
      "bn-IN",
      "ta-IN",
      "te-IN",
      "mr-IN",
      "gu-IN",
      "kn-IN",
      "ml-IN",
      "od-IN",
      "pa-IN"
    ],
    "maxChars": 1500,
    "voices": [
      {
        "id": "anushka",
        "name": "Anushka",
        "language": "hi-IN",
        "licence": "Sarvam's stock voice; check its terms for commercial use of the audio."
      }
    ],
    "price": null,
    "waitsOn": "Chausar: a place in Connections to add your own key for it. Not in this build.",
    "manualPath": "Make the audio in the provider's own site or console with your account, and add the file to the order.",
    "note": "Indian languages, made in India. Its call is not written yet: it is checked against Sarvam's own docs first. Its price is not filled in: nobody has read it on the provider's page on a build day, and Chausar never guesses a price.",
    "label": "planned: write"
  },
  {
    "id": "elevenlabs",
    "name": "ElevenLabs",
    "languages": [
      "en-IN",
      "hi-IN",
      "ta-IN"
    ],
    "maxChars": 5000,
    "voices": [
      {
        "id": "default-stock",
        "name": "A stock voice from its library",
        "language": "en-IN",
        "licence": "ElevenLabs' stock voice; its paid plans allow commercial use of the audio."
      }
    ],
    "price": null,
    "waitsOn": "Chausar: a place in Connections to add your own key for it. Not in this build.",
    "manualPath": "Make the audio in the provider's own site or console with your account, and add the file to the order.",
    "note": "Natural voices; cloning needs the speaker's recorded consent. Its call is not written yet. Its price is not filled in: nobody has read it on the provider's page on a build day, and Chausar never guesses a price.",
    "label": "planned: write"
  }
] as const;
