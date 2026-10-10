// Preloaded into the server process: application network APIs fail immediately.
// Windows uses a fixed read-only PowerShell attributes query, so child-process
// execution remains available. This is an API guard, not an OS firewall.
import net from "node:net";
import tls from "node:tls";
import http from "node:http";
import https from "node:https";
import http2 from "node:http2";
import dns from "node:dns";
import dgram from "node:dgram";
import { syncBuiltinESMExports } from "node:module";
function blocked(): never { throw new Error("Network API disabled for offline test"); }
function replace(target: object, names: string[]): void {
  for (const name of names) Object.defineProperty(target, name, { value: blocked, configurable: true, writable: true });
}
globalThis.fetch = blocked;
replace(net.Socket.prototype, ["connect"]);
replace(net, ["connect", "createConnection", "createServer"]);
replace(tls, ["connect", "createServer"]);
replace(http, ["request", "get", "createServer"]);
replace(https, ["request", "get", "createServer"]);
replace(http2, ["connect", "createServer", "createSecureServer"]);
replace(dns, ["lookup", "resolve", "resolve4", "resolve6"]);
replace(dns.promises, ["lookup", "resolve", "resolve4", "resolve6"]);
replace(dgram, ["createSocket"]);
syncBuiltinESMExports();
