import {spawn, execFileSync} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {once} from 'node:events';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {createReaderServer} from '../../dist-server/app.cjs';

// The ephemeral store resets IndexedDB and localStorage. An empty key keeps the
// example in demo mode. The test server never reads the user's .env files.
const temp = await mkdtemp(join(tmpdir(), 'jiandu-webkit-'));
let server, probe;
function interrupt() { probe?.kill(); }
try {
  const binary = join(temp, 'probe');
  execFileSync('clang', ['-fobjc-arc', '-framework', 'AppKit', '-framework', 'WebKit',
    'tests/mac/probe.m', '-o', binary], {stdio: 'inherit'});
  server = createReaderServer(resolve('dist'), '', undefined, temp);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + server.address().port;
  probe = spawn(binary, [origin, resolve('tests/mac/reader.js')], {stdio: 'inherit'});
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  const [status] = await once(probe, 'exit');
  process.exitCode = status ?? 1;
} finally {
  process.off('SIGINT', interrupt);
  process.off('SIGTERM', interrupt);
  probe?.kill();
  if (server) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  await rm(temp, {recursive: true, force: true});
}
