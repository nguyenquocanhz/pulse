import fs from 'node:fs';
import path from 'node:path';

/**
 * Lưu trữ kết quả kiểm tra.
 *
 * Cố ý KHÔNG dùng database: một uptime monitor cho homelab ghi vài bản ghi mỗi
 * phút, và ràng buộc người dùng vào SQLite/Postgres chỉ để chứa từng đó dữ liệu
 * là đánh đổi tồi. Ở đây mỗi monitor một file NDJSON, cắt bớt khi quá dài.
 *
 * Đánh đổi phải biết: toàn bộ lịch sử của một monitor được giữ trong bộ nhớ khi
 * đọc. Với giới hạn mặc định 2000 bản ghi thì chỉ vài trăm KB, hoàn toàn ổn.
 * Nếu cần giữ hàng triệu điểm dữ liệu thì đây không phải công cụ phù hợp.
 */

const MAX_RECORDS = 2000;

export class Store {
  constructor(dir = './data') {
    this.dir = dir;
    fs.mkdirSync(this.dir, { recursive: true });
    this.cache = new Map();
  }

  /** Tên file an toàn: id do người dùng đặt, không được thoát ra khỏi thư mục data */
  file(id) {
    const safe = String(id).replace(/[^a-zA-Z0-9._-]/g, '_');
    return path.join(this.dir, `${safe}.ndjson`);
  }

  load(id) {
    if (this.cache.has(id)) return this.cache.get(id);

    let records = [];
    try {
      const raw = fs.readFileSync(this.file(id), 'utf8');
      records = raw
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            // Bỏ qua dòng hỏng thay vì làm sập cả monitor. Ghi vào lúc mất điện
            // có thể để lại một dòng dở dang.
            return null;
          }
        })
        .filter(Boolean);
    } catch {
      records = [];
    }

    this.cache.set(id, records);
    return records;
  }

  append(id, record) {
    const records = this.load(id);
    records.push(record);

    if (records.length > MAX_RECORDS) {
      records.splice(0, records.length - MAX_RECORDS);
      // Đã cắt thì phải ghi lại cả file, nếu không file cứ phình mãi
      fs.writeFileSync(this.file(id), records.map((r) => JSON.stringify(r)).join('\n') + '\n');
    } else {
      fs.appendFileSync(this.file(id), JSON.stringify(record) + '\n');
    }

    return record;
  }

  /** Số liệu tóm tắt cho trang trạng thái. */
  summary(id, windowSize = 100) {
    const records = this.load(id);
    if (!records.length) {
      return { state: 'unknown', uptime: null, avgMs: null, last: null, history: [] };
    }

    const recent = records.slice(-windowSize);
    const okCount = recent.filter((r) => r.ok).length;
    const okDurations = recent.filter((r) => r.ok).map((r) => r.ms);

    const last = records[records.length - 1];

    return {
      state: last.ok ? 'up' : 'down',
      uptime: Math.round((okCount / recent.length) * 1000) / 10,
      avgMs: okDurations.length
        ? Math.round(okDurations.reduce((a, b) => a + b, 0) / okDurations.length)
        : null,
      last,
      // chỉ trả phần tối thiểu để vẽ biểu đồ thanh, không gửi cả lịch sử
      history: recent.map((r) => ({ t: r.t, ok: r.ok, ms: r.ms })),
    };
  }
}
