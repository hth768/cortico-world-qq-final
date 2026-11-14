import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { downloadBytes } from '../src/download.ts';

test('图片正文停滞会超时，超大流会中止，后续下载仍可完成', async () => {
  const server = createServer((request, response) => {
    if (request.url === '/stall') {
      response.writeHead(200);
      response.write('partial');
    } else if (request.url === '/large') {
      response.writeHead(200);
      response.write(Buffer.alloc(64));
      response.end(Buffer.alloc(64));
    } else response.end('ok');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const url = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal(await downloadBytes(url + '/stall', 1024, 100), null);
    assert.equal(await downloadBytes(url + '/large', 32, 1000), null);
    assert.equal(Buffer.from((await downloadBytes(url, 1024, 1000))!).toString(), 'ok');
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
