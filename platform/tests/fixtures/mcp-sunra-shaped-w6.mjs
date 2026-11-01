// W6 6F9: a local stand-in with the same tool names, descriptions and input fields as @sunra/mcp-server 0.1.2.
// It never touches the network or Sunra. submit answers a synthetic request id; nothing is generated or paid.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const s = (description) => ({ type: 'string', description });
const tool = (name, description, properties, required = []) => ({ name, description, inputSchema: { type: 'object', properties, required } });
const tools = [
  tool('submit', 'Submit a request to the Sunra queue for processing', { endpointId: s('The ID of the API endpoint to submit to'), input: { description: 'The input data to send to the endpoint' }, webhookUrl: s('Optional webhook URL') }, ['endpointId']),
  tool('subscribe', 'Submit a request to the Sunra queue and wait for completion', { endpointId: s('The ID of the API endpoint to submit to'), input: {}, mode: { type: 'string', enum: ['polling', 'streaming'] }, pollInterval: { type: 'number' }, timeout: { type: 'number' }, logs: { type: 'boolean' }, webhookUrl: s('Optional webhook URL') }, ['endpointId']),
  tool('status', 'Check the status of a request in the Sunra queue', { requestId: s('The unique identifier for the request'), logs: { type: 'boolean' } }, ['requestId']),
  tool('result', 'Retrieve the result of a completed request from the Sunra queue', { requestId: s('The unique identifier for the request') }, ['requestId']),
  tool('cancel', 'Cancel a request in the Sunra queue', { requestId: s('The unique identifier for the request to cancel') }, ['requestId']),
  tool('list-models', 'List all available AI models from the Sunra API', { limit: { type: 'number' } }),
  tool('search-models', 'Search for AI models by keywords in their names, descriptions, or aliases', { keywords: s('Keywords'), limit: { type: 'number' } }, ['keywords']),
  tool('model-schema', 'Get the input and output JSON schemas for a specific AI model endpoint from its OpenAPI specification', { modelSlug: s('owner/model/endpoint') }, ['modelSlug']),
  tool('upload', 'Upload a file to Sunra storage and get back a URL', { file: s('base64'), contentType: s('MIME type'), fileName: s('name') }, ['file']),
  tool('set-sunra-key', 'Set the Sunra API key for authenticating with the Sunra.ai service', { apiKey: s('The Sunra API key to configure') }, ['apiKey']),
];
const server = new Server({ name: 'sunra-shaped-sample', version: '0.1.2' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async request => {
  const keyed = typeof process.env.SUNRA_KEY === 'string' && process.env.SUNRA_KEY.length > 0;
  const text = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
  if (request.params.name === 'submit') return text({ success: true, requestId: 'pd_synthetic_1', status: 'IN_QUEUE', keyed });
  if (request.params.name === 'status') return text({ success: true, status: 'COMPLETED', keyed });
  throw new Error('This synthetic sample only answers submit and status.');
});
await server.connect(new StdioServerTransport());
