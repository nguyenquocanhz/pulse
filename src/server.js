import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runCheck } from './checker.js';
import { Store } from './store.js';
import { notify } from './notify.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Vòng lặp kiểm tra + máy chủ HTTP, gói trong một tiến trình.
 *
 * Mỗi monitor chạy theo lịch riêng thay vì một vòng lặp chung: chu kỳ khác nhau
 * (10 giây và 5 phút) không nên bị ép vào cùng một nhịp, và một monitor chậm
 * không được làm trễ các monitor khác.
 */
export class Pulse {
  constructor(config, { dataDir = './data' } = {}) {
    this.config = config;
    this.store = new Store(dataDir);
    this.timers = [];
    // Trạng thái lần trước, để chỉ cảnh báo khi ĐỔI trạng thái
    this.lastState = new Map();
  }

  async checkOne(monitor) {
    const result = await runCheck(monitor);
    const record = { t: Date.now(), ok: result.ok, ms: result.ms, status: result.status };
    if (result.error) record.error = result.error;

    this.store.append(monitor.id, record);

    const prev = this.lastState.get(monitor.id);
    this.lastState.set(monitor.id, result.ok);

    // prev === undefined là lần chạy đầu: không cảnh báo, nếu không mỗi lần
    // khởi động lại tiến trình sẽ bắn một loạt thông báo "UP" vô nghĩa
    if (prev !== undefined && prev !== result.ok) {
      await notify(this.config.notifications, monitor, result, !result.ok);
    }

    return record;
  }

  start() {
    for (const monitor of this.config.monitors) {
      const interval = Math.max(5, monitor.interval ?? 60) * 1000;

      // chạy ngay một lần để trang trạng thái có dữ liệu, khỏi phải chờ hết chu kỳ
      this.checkOne(monitor).catch(() => {});

      const timer = setInterval(() => {
        this.checkOne(monitor).catch(() => {});
      }, interval);

      // Không giữ tiến trình sống chỉ vì timer, để Ctrl+C thoát dứt khoát
      timer.unref?.();
      this.timers.push(timer);
    }
  }

  stop() {
    this.timers.forEach(clearInterval);
    this.timers = [];
  }

  /** Dữ liệu cho trang trạng thái và cho API. */
  snapshot() {
    const monitors = this.config.monitors.map((m) => ({
      id: m.id,
      name: m.name || m.id,
      type: m.type || 'http',
      target: m.url || `${m.host}:${m.port}`,
      ...this.store.summary(m.id),
    }));

    const down = monitors.filter((m) => m.state === 'down');

    return {
      title: this.config.title || 'Pulse',
      updatedAt: new Date().toISOString(),
      // "degraded" khi có cái sập nhưng không phải tất cả — phân biệt được
      // "một dịch vụ lỗi" với "cả hệ thống chết"
      overall: down.length === 0 ? 'operational' : down.length === monitors.length ? 'down' : 'degraded',
      monitors,
    };
  }

  listen(port = 3001, host = '0.0.0.0') {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

      if (url.pathname === '/api/status') {
        const body = JSON.stringify(this.snapshot());
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          // Cho phép nhúng trang trạng thái vào dashboard khác
          'access-control-allow-origin': '*',
        });
        res.end(body);
        return;
      }

      /**
       * Endpoint cho giám sát bên ngoài. Trả 200 khi mọi thứ ổn, 503 khi có
       * dịch vụ sập — để dịch vụ uptime bên ngoài chỉ cần theo dõi MỘT URL này
       * là biết toàn bộ hệ thống.
       */
      if (url.pathname === '/healthz') {
        const snap = this.snapshot();
        const code = snap.overall === 'operational' ? 200 : 503;
        res.writeHead(code, { 'content-type': 'text/plain' });
        res.end(snap.overall);
        return;
      }

      if (url.pathname === '/' || url.pathname === '/index.html') {
        const file = path.join(__dirname, '..', 'public', 'index.html');
        fs.readFile(file, (err, data) => {
          if (err) {
            res.writeHead(500).end('Không đọc được trang trạng thái');
            return;
          }
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(data);
        });
        return;
      }

      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
    });

    server.listen(port, host);
    return server;
  }
}
