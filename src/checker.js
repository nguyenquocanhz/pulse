import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

/**
 * Chạy một lần kiểm tra. Không phụ thuộc thư viện ngoài — chỉ dùng core Node.
 *
 * Trả về hình dạng cố định cho mọi loại monitor, để phần lưu trữ và cảnh báo
 * không phải quan tâm loại nào:
 *   { ok, status, ms, error }
 */

const DEFAULT_TIMEOUT = 10000;

/** Kiểm tra HTTP/HTTPS. Mặc định coi 2xx và 3xx là thành công. */
const checkHttp = (monitor) =>
  new Promise((resolve) => {
    const started = Date.now();
    let url;

    try {
      url = new URL(monitor.url);
    } catch {
      resolve({ ok: false, status: 0, ms: 0, error: 'URL không hợp lệ' });
      return;
    }

    const lib = url.protocol === 'https:' ? https : http;
    const timeout = monitor.timeout ?? DEFAULT_TIMEOUT;

    const req = lib.request(
      url,
      {
        method: monitor.method || 'GET',
        headers: { 'user-agent': 'pulse/0.1', ...(monitor.headers || {}) },
        timeout,
        // Cho phép theo dõi endpoint dùng chứng chỉ tự ký trong mạng nội bộ
        rejectUnauthorized: monitor.insecure !== true,
      },
      (res) => {
        const chunks = [];
        let size = 0;

        res.on('data', (c) => {
          // Chỉ giữ phần đầu: monitor không cần tải cả trang, và body lớn
          // sẽ làm sai lệch thời gian phản hồi
          if (size < 65536) {
            chunks.push(c);
            size += c.length;
          }
        });

        res.on('end', () => {
          const ms = Date.now() - started;
          const body = Buffer.concat(chunks).toString('utf8');
          const status = res.statusCode;

          const expect = monitor.expectStatus;
          const statusOk = expect
            ? [].concat(expect).includes(status)
            : status >= 200 && status < 400;

          if (!statusOk) {
            resolve({ ok: false, status, ms, error: `Nhận HTTP ${status}` });
            return;
          }

          // keyword: bắt được trường hợp server trả 200 nhưng nội dung hỏng —
          // thứ mà healthcheck theo status code hoàn toàn không thấy
          if (monitor.keyword && !body.includes(monitor.keyword)) {
            resolve({
              ok: false,
              status,
              ms,
              error: `Không tìm thấy chuỗi "${monitor.keyword}" trong nội dung`,
            });
            return;
          }

          resolve({ ok: true, status, ms, error: null });
        });
      },
    );

    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, status: 0, ms: Date.now() - started, error: `Quá ${timeout}ms` });
    });

    req.on('error', (e) => {
      resolve({ ok: false, status: 0, ms: Date.now() - started, error: e.message });
    });

    if (monitor.body) req.write(monitor.body);
    req.end();
  });

/** Kiểm tra cổng TCP — dùng cho database, SSH, hoặc dịch vụ không nói HTTP. */
const checkTcp = (monitor) =>
  new Promise((resolve) => {
    const started = Date.now();
    const timeout = monitor.timeout ?? DEFAULT_TIMEOUT;

    const socket = net.createConnection({
      host: monitor.host,
      port: monitor.port,
      timeout,
    });

    const done = (result) => {
      socket.destroy();
      resolve(result);
    };

    socket.on('connect', () => done({ ok: true, status: 0, ms: Date.now() - started, error: null }));
    socket.on('timeout', () =>
      done({ ok: false, status: 0, ms: Date.now() - started, error: `Quá ${timeout}ms` }),
    );
    socket.on('error', (e) =>
      done({ ok: false, status: 0, ms: Date.now() - started, error: e.message }),
    );
  });

/**
 * Chạy kiểm tra, có thử lại.
 *
 * Vì sao cần retry: mạng chớp một nhịp là chuyện thường, và báo động vì một
 * lần trượt duy nhất sẽ khiến người dùng bắt đầu phớt lờ cảnh báo — thứ nguy
 * hiểm hơn cả việc không có cảnh báo.
 */
export const runCheck = async (monitor) => {
  const attempts = Math.max(1, monitor.retries ?? 1);
  let last;

  for (let i = 0; i < attempts; i += 1) {
    last = monitor.type === 'tcp' ? await checkTcp(monitor) : await checkHttp(monitor);
    if (last.ok) return last;

    if (i < attempts - 1) {
      await new Promise((r) => setTimeout(r, monitor.retryDelay ?? 2000));
    }
  }

  return last;
};

export const _internal = { checkHttp, checkTcp };
