// Original setup guides from implemented owner paths. Official provider references: NOTES-W5-GUIDES.md.
import type {ConnectorGuide} from '../contracts.ts';
export const PLAYBOOK_GUIDES:Readonly<Record<string,Omit<ConnectorGuide,'charges'|'missing'>>>=Object.freeze({
"website-cloudflare":{"steps": ["Create an existing Direct Upload project in your own Cloudflare account and upload the immutable assets there.", "In the website desk, enter the account, project and production branch, then enter a token scoped to that project for this session.", "Paste the exact asset manifest and release marker. Approve the preview, check its observed marker, then approve production separately."], "skipped": "Git-triggered projects are refused. A manifest does not upload missing assets. Unknown outcomes require inspection in Cloudflare before any retry.", "checks": "Chausar verifies the project and source checks, reads the exact deployment identity and observes its release marker. Missing evidence is not a pass.", "sends": "Sends: only the exact separately approved preview, production or rollback request. Connecting reads project settings without deploying.", "agentLimits": "Agents cannot deploy, promote a preview, upload assets, buy a domain or retry an uncertain write on their own."},
"website-public-site":{"steps": ["Set the approved public HTTPS client address in the website order.", "Open the website desk and choose Check public website. The request follows network and robots rules.", "For runtime UI checks, install lintapple yourself or attach its actual report. Read missing evidence as unmeasured."], "skipped": "Never treat a source-code audit or missing checker as a measured browser result. Restricted or private websites are not bypassed.", "checks": "Chausar records actual public-page results and the checker report when the installed checker is available.", "sends": "Sends: public read requests only. No forms, messages, site edits or deployment requests are sent.", "agentLimits": "Agents cannot bypass robots, install tools automatically or invent a passing measurement."},
 "tender-documents":{
  steps:['Attach client evidence separately from the RFP in the tender order.','Choose pasted questions or an RFP file. For a workbook, map the sheet, question column, answer column and row range.','Review every extracted question and its type before drafting. Write commercial answers yourself.'],
  skipped:'The RFP is a request, not evidence that the client meets it. Do not use a copied RFP as client evidence.',
  checks:'Chausar binds questions and answers to current source bytes. Changed sources require import and approval again.',
  sends:'Sends: nothing for local reading. A later AI request shows its exact source payload and asks separately.',
  agentLimits:'Agents cannot borrow documents from another client, invent certifications or write commercial answers.'
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
  "article-transcript": {
    "steps": [
      "Open the client article order and record your permission to use the episode.",
      "Add the episode transcript as SRT, VTT or TXT, then choose it in the article desk.",
      "Review the source and outline before drafting. Reuse a source only for the same client."
    ],
    "skipped": "Check that the file contains the episode words you may reuse, not unrelated private material.",
    "checks": "Chausar reads the selected file and binds drafts to its current source. There is no remote transcript account to check.",
    "sends": "Sends: nothing for file import. Any later model request has its own preview and approval.",
    "agentLimits": "Agents cannot borrow another client’s transcript or treat unsupported statements as source evidence."
  },
  "article-local-transcription": {
    "steps": [
      "Use the desktop app with ffmpeg and whisper.cpp already installed by you.",
      "Record episode rights, select the local audio or video in the article desk and approve the source import.",
      "Read the resulting transcript before drafting. If local tools are unavailable, add a transcript file instead."
    ],
    "skipped": "Local media is limited to 50 MB. For larger episodes, supply a transcript; Chausar does not install tools for you.",
    "checks": "The approved import copies the local source and checks the installed tools when transcription runs. Hosted web cannot run them.",
    "sends": "Sends: no recording to a remote transcription service. Processing uses the installed tools on this computer.",
    "agentLimits": "Agents cannot install software or claim a transcript exists when local processing fails."
  },
  "article-publishing": {
    "steps": [
      "Finish source review, the owner-approved outline and the article draft.",
      "Complete the required client-use review and approve the exact final article and companion text.",
      "Copy the approved handoff into the client publishing account and publish it yourself."
    ],
    "skipped": "A changed article needs fresh approval. No publishing password belongs in this handoff.",
    "checks": "Chausar checks the saved source and exact approval before preparing the handoff. It does not check a publishing account or prove publication.",
    "sends": "Sends: nothing to a publisher. Copy and publish the approved article yourself.",
    "agentLimits": "Agents cannot publish or mark a manual handoff as a confirmed live article."
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
  "newsletter-owner-tool": {
    "steps": [
      "Prepare the issue from approved sources in the newsletter desk. No sending-service key is needed.",
      "Before importing a recipient list or exporting, obtain the named lawyer’s consent confirmation. Draft preparation remains available meanwhile.",
      "Approve the exact issue and recipients, export HTML, plain text and recipient CSV, then send through your existing tool yourself."
    ],
    "skipped": "Consent review is not yet confirmed. Keep list use and export blocked until that review is genuinely recorded.",
    "checks": "Chausar checks current consent, suppression and exact approval before export. It does not connect to or test your sending account.",
    "sends": "Sends: nothing. You import the approved files and send with your own newsletter tool.",
    "agentLimits": "Agents cannot send email, bypass opt-outs or claim a successful delivery from an export."
  },
  "linkedin": {
    "steps": [
      "Read and approve the draft, then copy its text.",
      "Open LinkedIn yourself and sign in to the account you want to use.",
      "Paste the approved words and press Post or Send yourself. Chausar needs no LinkedIn password."
    ],
    "skipped": "LinkedIn is copy-and-open only. Do not set up browser automation or give Chausar your LinkedIn password.",
    "checks": "Chausar does not check LinkedIn access or verify that your manual post or message was sent.",
    "sends": "Sends: nothing to LinkedIn. You post or send in the LinkedIn account you signed in to.",
    "agentLimits": "A draft waits for your approval. Agents cannot post or message on LinkedIn or bypass its restrictions."
  }
});
