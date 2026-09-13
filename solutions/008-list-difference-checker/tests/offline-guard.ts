// Test-process guard. Module loading remains possible; application side effects fail.
import fs from "node:fs";
import net from "node:net";
import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import dgram from "node:dgram";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";

function blocked(): never { throw new Error("Unexpected side effect in offline stdio test"); }
function replace(target: object, names: string[]): void {
  for (const name of names) Object.defineProperty(target, name, { value: blocked, configurable: true, writable: true });
}
globalThis.fetch = blocked;
replace(net.Socket.prototype, ["connect"]);
replace(net, ["connect", "createConnection", "createServer"]);
replace(http, ["request", "get", "createServer"]);
replace(https, ["request", "get", "createServer"]);
replace(dns, ["lookup", "resolve", "resolve4", "resolve6"]);
replace(dns.promises, ["lookup", "resolve", "resolve4", "resolve6"]);
replace(dgram, ["createSocket"]);
replace(childProcess, ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]);
const mutations = ["writeFile", "appendFile", "truncate", "unlink", "rm", "rmdir", "mkdir", "rename", "copyFile", "cp", "chmod", "chown", "utimes", "link", "symlink", "mkdtemp"];
replace(fs, [...mutations, ...mutations.map(name => `${name}Sync`), "createWriteStream"]);
replace(fs.promises, mutations);
syncBuiltinESMExports();
