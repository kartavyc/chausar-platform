// Original setup guides for the implemented public recruitment boards.
import type {ConnectorGuide} from '../contracts.ts';
export const PLAYBOOK_GUIDES:Readonly<Record<string,Omit<ConnectorGuide,'charges'|'missing'>>>=Object.freeze({
 "tender-documents":{
  steps:['Attach client evidence separately from the RFP in the tender order.','Choose pasted questions or an RFP file. For a workbook, map the sheet, question column, answer column and row range.','Review every extracted question and its type before drafting. Write commercial answers yourself.'],
  skipped:'The RFP is a request, not evidence that the client meets it. Do not use a copied RFP as client evidence.',
  checks:'Chausar binds questions and answers to current source bytes. Changed sources require import and approval again.',
  sends:'Sends: nothing for local reading. A later AI request shows its exact source payload and asks separately.',
  agentLimits:'Agents cannot borrow another client documents, invent certifications or write commercial answers.'
 },
 "tender-submission":{
  steps:['Resolve source gaps and approve every answer by type.','Review the exact export pack, including the issuer workbook mapping and source amount receipts, then approve export.','Check the current issuer instructions and submit through your own portal or mail account.'],
  skipped:'A downloaded pack does not prove submission or acceptance. Check the issuer deadline and current terms yourself.',
  checks:'Chausar rechecks source bytes, exact answers and approvals before export. It does not test a portal account.',
  sends:'Sends: nothing to the issuer. You submit the approved files yourself.',
  agentLimits:'Agents cannot log in to a tender portal, submit a bid or claim the issuer accepted it.'
 },
  "seo-wordpress": {
    "steps": [
      "In the client WordPress profile, create a separate credential under Application Passwords for a user allowed to create drafts.",
      "In the SEO desk, enter the HTTPS site address, username and application password for this session.",
      "Review the current client-approved article, approve saving its exact draft, then publish it yourself in WordPress."
    ],
    "skipped": "Use a dedicated user with only the needed draft permissions. An application password inherits that user’s access; it is not a draft-only permission.",
    "checks": "Saving settings does not test WordPress credentials. The approved draft request checks the response; the later public-page check verifies the approved article.",
    "sends": "Sends: only the exact client and owner approved article as a draft. The owner publishes it.",
    "agentLimits": "Agents cannot publish, email or retry an unknown result. Check WordPress yourself if the save is uncertain."
  },
  "seo-cloudflare-kv": {
    "steps": [
      "Ask the client developer for the existing Worker, namespace, account ID and exact override key.",
      "Create an API token with Workers KV Storage Write access for only the chosen account, then enter its token, namespace ID and site in the SEO desk.",
      "Review the existing value and client-approved replacement, then approve the exact change. Undo asks separately."
    ],
    "skipped": "The client must already have a Worker using this namespace. Chausar does not install one or create the namespace.",
    "checks": "Saving settings checks their shape, not live access. Staging reads the existing key; applying checks the saved value. Changes can take time to appear elsewhere.",
    "sends": "Sends: only an exact approved existing-key replacement or separately approved undo.",
    "agentLimits": "Agents cannot provision Workers, change other keys or retry an unknown write. Inspect uncertain results manually."
  },
  "overpass": {
    "steps": [
      "In the lead desk, choose a city area and the kind of business you want to research.",
      "Review the bounded area and run the one-off public map search. No key is needed.",
      "Check the returned sources and keep OpenStreetMap attribution with any reused data."
    ],
    "skipped": "OpenStreetMap coverage can be incomplete. Keep attribution and the ODbL licence on derived databases.",
    "checks": "There is no sign-in check. The requested bounded Overpass query either returns public map records or a clear refusal.",
    "sends": "Sends: only the chosen public map query. It does not contact businesses or change OpenStreetMap.",
    "agentLimits": "Agents cannot turn missing map details into verified emails or run unrestricted scraping."
  },
  "nominatim": {
    "steps": [
      "Read https://operations.osmfoundation.org/policies/nominatim/ before using the public city lookup.",
      "Enter a city name deliberately in the lead desk. Never send personal addresses or confidential text.",
      "Check the returned city area. If lookup is unavailable, choose the city box manually."
    ],
    "skipped": "Use city lookups only. No autocomplete, repeated bulk geocoding, systematic area searches or resale of geocoding results.",
    "checks": "No key is checked. Deliberate lookups are cached and serialised with at most one request per second.",
    "sends": "Sends: the requested city name to the public Nominatim service, not a customer address.",
    "agentLimits": "Agents cannot use this as a general address service. Respect the linked policy and keep map attribution."
  },
  "own-site": {
    "steps": [
      "Choose the business’s own public website for a lead in the lead desk.",
      "Request the limited contact-page read only where the site terms permit it.",
      "Review each found contact and its source before keeping or using it."
    ],
    "skipped": "Chausar obeys robots and reads the homepage plus at most three same-host contact pages. A refusal is not bypassed.",
    "checks": "There is no account check. Public page reads use the network and source-policy guards; missing details remain missing.",
    "sends": "Sends: public page requests only. No forms, emails or messages are submitted.",
    "agentLimits": "Agents cannot guess email addresses, enter private accounts or evade site restrictions."
  },
  "happenstance": {
    "steps": [
      "Use your own Happenstance account and API key from its developer settings.",
      "In the lead desk, write the exact search and read the dated credit quote.",
      "Enter your key for this search and approve the displayed query and credit cost together."
    ],
    "skipped": "The query can use your network. Check the exact text and current credit quote before approving; a key alone is not permission to spend.",
    "checks": "There is no separate key test. The exact approved search checks the provider response and records whether it was confirmed.",
    "sends": "Sends: only the exact owner-approved paid search. Open the returned Happenstance result yourself.",
    "agentLimits": "Agents cannot send outreach or retry an unknown search. Check your Happenstance account after an uncertain result."
  },

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
