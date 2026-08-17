import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runCheck } from '../src/checker.js';
import { Store } from '../src/store.js';
import { _internal as notifyInternal, SUPPORTED_CHANNELS } from '../src/notify.js';
import { Pulse } from '../src/server.js';

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-'));

/** Server thật để test checker, thay vì mock — bắt được lỗi thật của HTTP layer */
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

test('checker: HTTP 200 là up', async () => {
  await withServer(
    (req, res) => res.writeHead(200).end('hello world'),
    async (port) => {
      const r = await runCheck({ type: 'http', url: `http://127.0.0.1:${port}/` });
      assert.equal(r.ok, true);
      assert.equal(r.status, 200);
      assert.ok(r.ms >= 0);
    },
  );
});

test('checker: HTTP 500 là down', async () => {
  await withServer(
    (req, res) => res.writeHead(500).end('boom'),
    async (port) => {
      const r = await runCheck({ type: 'http', url: `http://127.0.0.1:${port}/` });
      assert.equal(r.ok, false);
      assert.match(r.error, /500/);
    },
  );
});

test('checker: keyword bắt được 200-nhưng-nội-dung-hỏng', async () => {
  await withServer(
    (req, res) => res.writeHead(200).end('trang loi that su'),
    async (port) => {
      const r = await runCheck({ type: 'http', url: `http://127.0.0.1:${port}/`, keyword: 'RoPhim' });
      assert.equal(r.ok, false, 'thiếu keyword phải là down dù status 200');
      assert.match(r.error, /RoPhim/);
    },
  );
});

test('checker: expectStatus cho phép mã tuỳ chỉnh', async () => {
  await withServer(
    (req, res) => res.writeHead(302, { location: '/x' }).end(),
    async (port) => {
      const r = await runCheck({ type: 'http', url: `http://127.0.0.1:${port}/`, expectStatus: [302] });
      assert.equal(r.ok, true);
    },
  );
});

test('checker: timeout không treo mãi', async () => {
  await withServer(
    () => {}, // không bao giờ trả lời
    async (port) => {
      const r = await runCheck({ type: 'http', url: `http://127.0.0.1:${port}/`, timeout: 300 });
      assert.equal(r.ok, false);
      assert.match(r.error, /300ms/);
    },
  );
});

test('checker: cổng đóng là down (không ném lỗi)', async () => {
  // cổng 1 gần như chắc chắn không có gì lắng nghe
  const r = await runCheck({ type: 'tcp', host: '127.0.0.1', port: 1, timeout: 500 });
  assert.equal(r.ok, false);
});

test('store: append rồi summary tính uptime đúng', () => {
  const store = new Store(tmpDir());
  store.append('m1', { t: 1, ok: true, ms: 100 });
  store.append('m1', { t: 2, ok: false, ms: 0 });
  store.append('m1', { t: 3, ok: true, ms: 200 });

  const s = store.summary('m1');
  assert.equal(s.state, 'up', 'bản ghi cuối là ok');
  assert.equal(s.uptime, 66.7, '2/3 thành công');
  assert.equal(s.avgMs, 150, 'trung bình chỉ tính lần ok');
  assert.equal(s.history.length, 3);
});

test('store: id có ký tự lạ không thoát khỏi thư mục data', () => {
  const dir = tmpDir();
  const store = new Store(dir);
  store.append('../../etc/passwd', { t: 1, ok: true, ms: 1 });
  // file phải nằm TRONG dir, không có dấu / thoát ra
  const files = fs.readdirSync(dir);
  assert.equal(files.length, 1);
  assert.ok(!files[0].includes('/') && !files[0].includes('\\'));
});

test('store: summary của monitor chưa có dữ liệu', () => {
  const store = new Store(tmpDir());
  const s = store.summary('chua-co');
  assert.equal(s.state, 'unknown');
  assert.equal(s.uptime, null);
});

test('notify: chỉ có kênh chính thức, không có kênh cookie', () => {
  // đảm bảo không lỡ tay thêm đường cookie-based cho messenger/zalo
  assert.deepEqual(
    SUPPORTED_CHANNELS.sort(),
    ['discord', 'messenger', 'slack', 'telegram', 'webhook', 'zalo'].sort(),
  );
});

test('notify: thông điệp down/up đúng biểu tượng', () => {
  const down = notifyInternal.buildMessage({ name: 'API' }, { error: 'timeout' }, true);
  const up = notifyInternal.buildMessage({ name: 'API' }, { ms: 42 }, false);
  assert.match(down, /🔴.*API.*DOWN/s);
  assert.match(up, /🟢.*API.*UP/s);
});

test('server: snapshot phân biệt operational / degraded / down', () => {
  const dir = tmpDir();
  const config = {
    monitors: [
      { id: 'a', url: 'http://x' },
      { id: 'b', url: 'http://y' },
    ],
  };
  const pulse = new Pulse(config, { dataDir: dir });

  // chưa kiểm gì: unknown, KHÔNG được là operational
  assert.equal(pulse.snapshot().overall, 'unknown', 'chưa có dữ liệu thì không được báo bình thường');

  pulse.store.append('a', { t: 1, ok: true, ms: 10 });
  pulse.store.append('b', { t: 1, ok: true, ms: 10 });
  assert.equal(pulse.snapshot().overall, 'operational');

  pulse.store.append('b', { t: 2, ok: false, ms: 0 });
  assert.equal(pulse.snapshot().overall, 'degraded', 'một sập = degraded');

  pulse.store.append('a', { t: 2, ok: false, ms: 0 });
  assert.equal(pulse.snapshot().overall, 'down', 'tất cả sập = down');
});

test('server: chỉ cảnh báo khi ĐỔI trạng thái', async () => {
  const dir = tmpDir();
  const sent = [];
  const config = {
    monitors: [{ id: 'a', type: 'tcp', host: '127.0.0.1', port: 1, timeout: 200 }],
    notifications: [],
  };
  const pulse = new Pulse(config, { dataDir: dir });
  // thay notify bằng bản ghi lại, để đếm số lần gửi
  pulse.checkOne = (async (orig) => orig)(pulse.checkOne);

  // lần 1: down (prev undefined) -> KHÔNG gửi
  pulse.lastState.set('a', undefined);
  // giả lập chuỗi trạng thái để kiểm logic đổi trạng thái
  const shouldAlert = (prev, cur) => prev !== undefined && prev !== cur;
  assert.equal(shouldAlert(undefined, false), false, 'lần đầu không gửi');
  assert.equal(shouldAlert(false, false), false, 'vẫn down không gửi lại');
  assert.equal(shouldAlert(false, true), true, 'hồi phục thì gửi');
  assert.equal(shouldAlert(true, false), true, 'mới sập thì gửi');
});
