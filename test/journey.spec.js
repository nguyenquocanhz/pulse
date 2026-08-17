import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { runJourney, _internal_journey } from '../src/journey.js';

const { getJsonPath, interpolate, extractVars } = _internal_journey;

// server thật để chạy journey end-to-end
const withServer = async (handler, fn) => {
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    return await fn(port);
  } finally {
    server.close();
  }
};

// ---------------------------------------------------------------- unit

test('getJsonPath: lấy được giá trị lồng nhau và index mảng', () => {
  const obj = { result: { items: [{ public_id: 'abc123' }, { public_id: 'def' }] } };
  assert.equal(getJsonPath(obj, 'result.items.0.public_id'), 'abc123');
  assert.equal(getJsonPath(obj, 'result.items.1.public_id'), 'def');
  assert.equal(getJsonPath(obj, 'result.khong.co'), undefined);
});

test('interpolate: thay {{var}} và encode, giữ nguyên biến chưa có', () => {
  assert.equal(interpolate('/x?id={{id}}', { id: 'a b' }), '/x?id=a%20b');
  assert.equal(interpolate('/x?id={{id}}', {}), '/x?id={{id}}', 'biến chưa có thì giữ nguyên');
});

test('extractVars: trích JSON và regex', () => {
  const body = JSON.stringify({ result: { items: [{ public_id: 'movie99' }] } });
  assert.deepEqual(
    extractVars({ mid: { json: 'result.items.0.public_id' } }, body),
    { mid: 'movie99' },
  );
  assert.deepEqual(
    extractVars({ tok: { regex: 'token=(\\w+)' } }, 'x token=SECRET y'),
    { tok: 'SECRET' },
  );
});

// ---------------------------------------------------------------- e2e

test('journey: mọi bước xanh -> ok, có latency từng chặng', async () => {
  await withServer(
    (req, res) => res.writeHead(200).end('ok'),
    async (port) => {
      const r = await runJourney({
        type: 'journey',
        steps: [
          { name: 'A', url: `http://127.0.0.1:${port}/a` },
          { name: 'B', url: `http://127.0.0.1:${port}/b` },
        ],
      });
      assert.equal(r.ok, true);
      assert.equal(r.steps.length, 2);
      assert.equal(r.steps[0].name, 'A');
      assert.ok(r.steps.every((s) => s.ok && s.ms >= 0));
    },
  );
});

test('journey: hỏng ở bước 2 -> dừng, báo đúng chặng', async () => {
  await withServer(
    (req, res) => {
      if (req.url === '/b') return res.writeHead(500).end('boom');
      res.writeHead(200).end('ok');
    },
    async (port) => {
      const r = await runJourney({
        type: 'journey',
        steps: [
          { name: 'Trang chủ', url: `http://127.0.0.1:${port}/a` },
          { name: 'API', url: `http://127.0.0.1:${port}/b` },
          { name: 'Không bao giờ chạy', url: `http://127.0.0.1:${port}/c` },
        ],
      });
      assert.equal(r.ok, false);
      assert.match(r.error, /API/, 'phải nêu tên chặng hỏng');
      assert.equal(r.steps.length, 2, 'dừng ngay sau bước hỏng, không chạy bước 3');
      assert.equal(r.steps[0].ok, true);
      assert.equal(r.steps[1].ok, false);
    },
  );
});

test('journey: nối chuỗi — bước sau dùng biến trích từ bước trước', async () => {
  await withServer(
    (req, res) => {
      if (req.url === '/list') {
        return res.writeHead(200).end(JSON.stringify({ result: { items: [{ public_id: 'X42' }] } }));
      }
      // bước 2 chỉ 200 nếu id đúng được truyền qua
      if (req.url === '/get?movie_id=X42') return res.writeHead(200).end('found');
      res.writeHead(404).end('wrong id');
    },
    async (port) => {
      const r = await runJourney({
        type: 'journey',
        steps: [
          {
            name: 'Danh sách',
            url: `http://127.0.0.1:${port}/list`,
            extract: { mid: { json: 'result.items.0.public_id' } },
          },
          { name: 'Chi tiết', url: `http://127.0.0.1:${port}/get?movie_id={{mid}}` },
        ],
      });
      assert.equal(r.ok, true, 'nếu nối chuỗi sai, bước 2 nhận 404 và journey down');
      assert.equal(r.steps[1].ok, true);
    },
  );
});
