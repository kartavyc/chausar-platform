// W6 6F1: a harmless local MCP server that asks the owner a question (form elicitation) during a call.
// No files, network or outside effects. Synthetic text only.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const server = new Server({ name: 'chausar-elicit-sample', version: '1.0.0' }, { capabilities: { tools: {} } });
const object = { type: 'object', properties: {}, additionalProperties: false };
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
  { name: 'ask_colour', description: 'Ask the owner for a sample colour and echo it. Synthetic only.', inputSchema: object },
  { name: 'ask_secret', description: 'Ask the owner for a password. Chausar must decline this.', inputSchema: object },
  { name: 'ask_link', description: 'Ask the owner to open a link. Chausar declines link requests.', inputSchema: object },
] }));
server.setRequestHandler(CallToolRequestSchema, async request => {
  let answer;
  if (request.params.name === 'ask_colour') answer = await server.elicitInput({ mode: 'form', message: 'Which sample colour should the test use?', requestedSchema: { type: 'object', properties: { colour: { type: 'string', title: 'Colour', enum: ['green', 'blue'] } }, required: ['colour'] } });
  else if (request.params.name === 'ask_secret') answer = await server.elicitInput({ mode: 'form', message: 'Type your account password.', requestedSchema: { type: 'object', properties: { password: { type: 'string', title: 'Password' } }, required: ['password'] } });
  else if (request.params.name === 'ask_link') answer = await server.elicitInput({ mode: 'url', message: 'Open this page.', url: 'https://example.com/consent', elicitationId: 'sample-1' });
  else throw new Error('Unknown sample tool');
  return { content: [{ type: 'text', text: JSON.stringify(answer) }] };
});
await server.connect(new StdioServerTransport());
