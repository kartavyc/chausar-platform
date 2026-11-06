import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const server = new Server({ name: 'chausar-harmless-sample', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: 'echo_sample', description: 'Return the synthetic sample text. No files, network or outside effects.', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false }, annotations: { readOnlyHint: true } }] }));
server.setRequestHandler(CallToolRequestSchema, async request => {
  if (request.params.name !== 'echo_sample') throw new Error('Unknown sample tool');
  return { content: [{ type: 'text', text: String(request.params.arguments?.text ?? '') }] };
});
await server.connect(new StdioServerTransport());
