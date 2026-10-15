import type { Server } from 'node:http';
/** Create the allowlisted static developer server; listen on 127.0.0.1 only. */
/** `phonePage: true` switches on the experimental PH-04 phone page (off by default). */
export declare function createPhoneWebPreviewServer(options?: { phonePage?: boolean }): Server;
