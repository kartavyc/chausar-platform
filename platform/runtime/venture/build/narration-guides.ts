// Original setup guides for actual narration desk paths. Official sources are recorded in NOTES-5Q.
import type {ConnectorGuide} from '../contracts.ts';
export const NARRATION_GUIDES:Readonly<Record<string,Omit<ConnectorGuide,'charges'|'missing'>>>=Object.freeze({
  "google-tts": {
    "steps": [
      "Use your own Google Cloud project with billing and Text-to-Speech enabled. Restrict its API key to that API.",
      "Open the narration desk, choose the client order and save the project key. Saving does not make a test call.",
      "Read the current text, licensed stock voice and exact computed cost. Approve that one request, then verify and listen to the actual audio."
    ],
    "skipped": "Client production waits for a named lawyer to confirm narration rights. Private manuscripts and cloning do not use this cloud route.",
    "checks": "Saving a key does not contact Google or prove access. An approved call checks the actual response; an uncertain outcome is never retried automatically.",
    "sends": "Sends: only the exact approved text and stock voice to Google, paid on your own key.",
    "agentLimits": "Agents cannot approve paid speech, switch the approved account, clone a voice or claim distributor acceptance."
  },
  "narration-files": {
    "steps": [
      "Attach a rights-cleared TXT, Markdown or DOCX manuscript to this client order.",
      "In the narration desk, select that file and a licensed stock voice.",
      "Review the exact source segments. After source changes, prepare them again before approval."
    ],
    "skipped": "A filename or cached digest is not evidence. Current stored bytes and current manuscript rights must agree.",
    "checks": "Chausar reads the actual bounded file and rechecks the current client and rights. Unreadable or unsupported files refuse.",
    "sends": "Sends: nothing outside Chausar while importing the manuscript. Any later AI or speech call asks separately.",
    "agentLimits": "Agents cannot borrow another client source, invent rights or send a private manuscript to the cloud."
  },
  "narration-local-checks": {
    "steps": [
      "Install ffmpeg and whisper.cpp yourself on the desktop computer.",
      "Open a current narration segment with its actual audio. Choose Transcribe and measure.",
      "Listen and approve the exact audio, master it, then listen again to the newly measured file."
    ],
    "skipped": "Missing tools or measurements never pass. Automatic word similarity cannot judge tone or natural pacing.",
    "checks": "The desktop copies current audio bytes to local scratch, transcribes without an expected-text prompt, measures and removes scratch files afterward.",
    "sends": "Sends: nothing to a speech-recognition provider. These installed tools run on the desktop.",
    "agentLimits": "Agents cannot install tools, enter made-up measurements or replace owner listening approval."
  },
  "narration-distribution": {
    "steps": [
      "Master and listen to every current segment, then approve export with AI narration disclosure.",
      "Read the target distributor current rules and check the exported audio and disclosure yourself.",
      "Upload through your own distributor account. Check its actual acceptance response."
    ],
    "skipped": "A technical pass is not acceptance. ACX and unqualified external Google Play synthetic narration remain blocked.",
    "checks": "Chausar checks source, actual audio, owner listening and current rights before export. It does not check a distributor login.",
    "sends": "Sends: nothing to a distributor. The owner downloads and submits the approved files manually.",
    "agentLimits": "Agents cannot upload, submit, accept terms or promise distributor acceptance."
  }
});
