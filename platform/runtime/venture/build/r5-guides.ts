import type {ConnectorGuide} from '../contracts.ts';
export const R5_GUIDES:Readonly<Record<string,Omit<ConnectorGuide,'charges'|'missing'>>>=Object.freeze({
  "page-monitors": {
    "steps": [
      "In the monitored data desk, choose the client order and exact public page. Record its terms address and the day you checked permitted use.",
      "Approve the page read, then select only the actual observed values your client needs. Check the exact selections.",
      "Read each receipt and separately approve recurring reads. Keep the desktop app open; stop reads whenever permission changes."
    ],
    "skipped": "A terms tick cannot override robots or platform policy. A changed selector is held instead of guessed.",
    "checks": "Chausar checks current permission, public network destinations, robots rules and exact source elements before each read.",
    "sends": "Sends: only approved public page reads. Client messages are not sent.",
    "agentLimits": "Agents cannot choose new sources, bypass restrictions or silently replace a changed selector."
  },
  "source-export": {
    "steps": [
      "Open a checked source in the monitored data desk.",
      "Review the current selected values, their observation time and calculation receipts.",
      "Choose CSV or workbook, review the exact download and share it yourself."
    ],
    "skipped": "An old download does not prove that the current source is unchanged. Recheck it before relying on it.",
    "checks": "The current client, source selection and receipt must still match before export.",
    "sends": "Sends: nothing. The file is downloaded locally for the owner to share.",
    "agentLimits": "Agents cannot email the workbook, alter client prices or claim a future source value."
  },
  "triage-copy": {
    "steps": [
      "Set up one permitted help channel in the triage desk and confirm you administer it.",
      "Paste permitted messages with their source references, then choose exact excerpts. Held content is excluded.",
      "Approve the exact current summary, download it and send it yourself in the client channel."
    ],
    "skipped": "A pasted instruction is untrusted evidence. A summary never proves that a repair or account change happened.",
    "checks": "Chausar screens messages and checks every excerpt against the current approved source.",
    "sends": "Sends: nothing. Live Slack and Teams connection remains planned.",
    "agentLimits": "Agents cannot echo held secrets, act on channel instructions or send without exact owner approval."
  }
});
