// Original owner setup for local caption capture. No model weights or provider access are bundled.
import type {ConnectorGuide} from '../contracts.ts';
export const TRANSLATION_GUIDES:Readonly<Record<string,Omit<ConnectorGuide,'charges'|'missing'>>>=Object.freeze({
  "local-live-captions": {
    "steps": [
      "Install and configure local whisper.cpp in Connections, Your AI. Record the event host permission in a live-caption order.",
      "Open Translation, choose that caption order and Start local captions. Only this desktop microphone is used.",
      "Saving starts off. Enable Save future captions only when you want confirmed lines kept. Stop capture when the event ends."
    ],
    "skipped": "Local model speed and language accuracy vary. Speaker labels are owner supplied, not automatic identification. Turning saving off does not delete previously saved lines.",
    "checks": "Chausar checks local tool availability and current host permission before capture and after each recognition. Missing tools stop capture.",
    "sends": "Sends: nothing over the network. Audio goes to installed local whisper.cpp; there is no cloud fallback.",
    "agentLimits": "Agents cannot start the microphone, enable saving, install models or send event audio to a remote service."
  }
});
