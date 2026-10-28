// Original setup guides for the implemented public recruitment boards.
import type {ConnectorGuide} from '../contracts.ts';
export const PLAYBOOK_GUIDES:Readonly<Record<string,Omit<ConnectorGuide,'charges'|'missing'>>>=Object.freeze({
  "recruit-ashby": {
    "steps": [
      "Open the employer’s public Ashby jobs page and copy its board name. No API key is needed.",
      "In the recruiting role, choose this provider and board, then set the exact job filters.",
      "Read and approve the board and filters before installation. Read it again when you want fresh matches."
    ],
    "skipped": "Use the employer’s public board name, not an applicant profile or private hiring dashboard.",
    "checks": "Installation reads the public board. The first read seeds current jobs without alerts; later reads compare new matching jobs.",
    "sends": "Sends: a public jobs read only. No applications, candidate profiles or messages are sent.",
    "agentLimits": "Agents cannot apply, contact candidates or change the approved board filters themselves."
  },

  "recruit-lever": {
    "steps": [
      "Open the employer’s public Lever jobs page and copy its board name. No API key is needed.",
      "In the recruiting role, choose this provider and board, then set the exact job filters.",
      "Read and approve the board and filters before installation. Read it again when you want fresh matches."
    ],
    "skipped": "Use the employer’s public board name, not an applicant profile or private hiring dashboard.",
    "checks": "Installation reads the public board. The first read seeds current jobs without alerts; later reads compare new matching jobs.",
    "sends": "Sends: a public jobs read only. No applications, candidate profiles or messages are sent.",
    "agentLimits": "Agents cannot apply, contact candidates or change the approved board filters themselves."
  },

  "recruit-greenhouse": {
    "steps": [
      "Open the employer’s public Greenhouse jobs page and copy its board name. No API key is needed.",
      "In the recruiting role, choose this provider and board, then set the exact job filters.",
      "Read and approve the board and filters before installation. Read it again when you want fresh matches."
    ],
    "skipped": "Use the employer’s public board name, not an applicant profile or private hiring dashboard.",
    "checks": "Installation reads the public board. The first read seeds current jobs without alerts; later reads compare new matching jobs.",
    "sends": "Sends: a public jobs read only. No applications, candidate profiles or messages are sent.",
    "agentLimits": "Agents cannot apply, contact candidates or change the approved board filters themselves."
  },

});
