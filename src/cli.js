#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

import { Pulse } from './server.js';

/**
 * Điểm khởi động. Đọc config, chạy vòng kiểm tra, mở máy chủ trạng thái.
 *
 *   pulse                          dùng ./monitors.json
 *   pulse path/to/config.json      dùng file chỉ định
 *
 * Biến môi trường:
 *   PULSE_PORT   cổng máy chủ (mặc định 3001)
 *   PULSE_DATA   thư mục lưu dữ liệu (mặc định ./data)
 */

const configPath = process.argv[2] || './monitors.json';

if (!fs.existsSync(configPath)) {
  console.error(`Không tìm thấy file cấu hình: ${configPath}`);
  console.error('Copy monitors.example.json thành monitors.json rồi sửa lại.');
  process.exit(1);
}

let config;
try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (e) {
  console.error(`Cấu hình không phải JSON hợp lệ: ${e.message}`);
  process.exit(1);
}

if (!Array.isArray(config.monitors) || config.monitors.length === 0) {
  console.error('Cấu hình phải có mảng "monitors" với ít nhất một mục.');
  process.exit(1);
}

// Bắt buộc mỗi monitor có id để làm khoá lưu trữ và cảnh báo
const ids = new Set();
for (const m of config.monitors) {
  if (!m.id) {
    console.error(`Mỗi monitor phải có "id". Thiếu ở: ${JSON.stringify(m).slice(0, 80)}`);
    process.exit(1);
  }
  if (ids.has(m.id)) {
    console.error(`Trùng id monitor: "${m.id}". Mỗi id phải là duy nhất.`);
    process.exit(1);
  }
  ids.add(m.id);
}

const port = Number(process.env.PULSE_PORT || config.port || 3001);
const dataDir = process.env.PULSE_DATA || config.dataDir || './data';

const pulse = new Pulse(config, { dataDir });
pulse.start();
const server = pulse.listen(port);

console.log(`Pulse đang chạy`);
console.log(`  Trang trạng thái : http://localhost:${port}`);
console.log(`  API              : http://localhost:${port}/api/status`);
console.log(`  Healthcheck      : http://localhost:${port}/healthz`);
console.log(`  Theo dõi ${config.monitors.length} dịch vụ, ${(config.notifications || []).length} kênh cảnh báo`);

const shutdown = () => {
  console.log('\nĐang dừng…');
  pulse.stop();
  server.close(() => process.exit(0));
  // đừng treo mãi nếu có kết nối chưa đóng
  setTimeout(() => process.exit(0), 2000).unref();
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
