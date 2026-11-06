import type { ModelTransport } from '../contracts.ts';
import { runExchange } from './scope.ts';

export function runTransport(transport: ModelTransport): ModelTransport {
  return {
    get replay() { return transport.replay; },
    http: request => runExchange(`http:${request.purpose}`, { url: request.url, method: request.method, body: request.body }, () => transport.http(request)),
    process: request => runExchange(`process:${request.purpose}`, { command: request.command, args: request.args, stdin: request.stdin }, () => transport.process(request)),
  };
}
