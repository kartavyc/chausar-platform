/** Original setup guides for the four implemented owner API connections. */
import type {ConnectorGuide} from '../contracts.ts';
export const OPEN_POSTING_GUIDES:Readonly<Record<string,Omit<ConnectorGuide,'charges'|'missing'>>>=Object.freeze({
  "bluesky": {
    "steps": [
      "Create an app password in your own Bluesky account. Record the exact handle and public server.",
      "In Connections, open More ways to connect, then Open networks. Enter the exact account and credential and approve its connection check.",
      "Review and accept the draft. Record the client approval where required, then approve each exact destination on Today."
    ],
    "skipped": "Use an app password, not the account password. Plain text only, within three hundred graphemes.",
    "checks": "Chausar verifies the account or channel through its official API. The credential stays in memory for this session.",
    "sends": "Sends: only a separately approved exact plain-text post. A connection check never publishes a post.",
    "agentLimits": "Agents cannot send direct messages, upload media, change the destination, retry an uncertain result or publish without owner approval."
  },
  "mastodon": {
    "steps": [
      "Create a token for your own Mastodon instance with permission to write statuses. Record its exact account.",
      "In Connections, open More ways to connect, then Open networks. Enter the exact account and credential and approve its connection check.",
      "Review and accept the draft. Record the client approval where required, then approve each exact destination on Today."
    ],
    "skipped": "Public visibility only. Chausar supports five hundred characters or the lower verified instance limit.",
    "checks": "Chausar verifies the account or channel through its official API. The credential stays in memory for this session.",
    "sends": "Sends: only a separately approved exact plain-text post. A connection check never publishes a post.",
    "agentLimits": "Agents cannot send direct messages, upload media, change the destination, retry an uncertain result or publish without owner approval."
  },
  "telegram": {
    "steps": [
      "Create your own bot and make it an administrator of the exact channel with permission to post messages.",
      "In Connections, open More ways to connect, then Open networks. Enter the exact account and credential and approve its connection check.",
      "Review and accept the draft. Record the client approval where required, then approve each exact destination on Today."
    ],
    "skipped": "Channel posts only. The bot needs administrator posting permission; no direct messages or markup.",
    "checks": "Chausar verifies the account or channel through its official API. The credential stays in memory for this session.",
    "sends": "Sends: only a separately approved exact plain-text post. A connection check never publishes a post.",
    "agentLimits": "Agents cannot send direct messages, upload media, change the destination, retry an uncertain result or publish without owner approval."
  },
  "discord": {
    "steps": [
      "Create an incoming webhook in the exact Discord server channel that you own or may manage.",
      "In Connections, open More ways to connect, then Open networks. Enter the exact account and credential and approve its connection check.",
      "Review and accept the draft. Record the client approval where required, then approve each exact destination on Today."
    ],
    "skipped": "Use the incoming webhook address for that channel. Chausar disables automatic mentions and waits for a returned message.",
    "checks": "Chausar verifies the account or channel through its official API. The credential stays in memory for this session.",
    "sends": "Sends: only a separately approved exact plain-text post. A connection check never publishes a post.",
    "agentLimits": "Agents cannot send direct messages, upload media, change the destination, retry an uncertain result or publish without owner approval."
  }
});
