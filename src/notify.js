import https from 'node:https';
import http from 'node:http';

/**
 * Gửi cảnh báo.
 *
 * Nguyên tắc quan trọng: CHỈ báo khi trạng thái ĐỔI, không báo mỗi lần kiểm tra.
 * Một dịch vụ sập 6 tiếng với chu kỳ 60 giây sẽ tạo ra 360 thông báo — và người
 * nhận sẽ tắt thông báo đi, tức là mất luôn tác dụng cảnh báo. Ở đây chỉ gửi
 * đúng hai lần: lúc sập và lúc hồi phục.
 */

const post = (url, payload, headers = {}) =>
  new Promise((resolve) => {
    let target;
    try {
      target = new URL(url);
    } catch {
      resolve({ ok: false, error: 'URL webhook không hợp lệ' });
      return;
    }

    const lib = target.protocol === 'https:' ? https : http;
    const data = JSON.stringify(payload);

    const req = lib.request(
      target,
      {
        method: 'POST',
        timeout: 10000,
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(data),
          ...headers,
        },
      },
      (res) => {
        res.resume();
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode });
      },
    );

    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'timeout' });
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));

    req.write(data);
    req.end();
  });

const buildMessage = (monitor, result, isDown) => {
  const name = monitor.name || monitor.id;
  if (isDown) {
    return `🔴 ${name} DOWN\n${result.error || `HTTP ${result.status}`}`;
  }
  return `🟢 ${name} UP\nPhản hồi ${result.ms}ms`;
};

/**
 * Một kênh = một hàm dựng {url, payload, headers} từ text và ngữ cảnh.
 * Thêm kênh mới chỉ là thêm một entry ở đây, không đụng vòng lặp.
 *
 * Về Messenger và Zalo: dùng ĐƯỜNG CHÍNH THỨC (Send API cần Page token / Zalo
 * OA cần access token). Cố tình KHÔNG hỗ trợ gửi qua cookie cá nhân — cách đó
 * vi phạm điều khoản, cookie hết hạn liên tục nên bot chết vặt, và tài khoản
 * dễ bị khóa. Một công cụ giám sát mà tự làm bay tài khoản người dùng là phản
 * tác dụng.
 */
const CHANNELS = {
  // Telegram Bot API — https://core.telegram.org/bots/api
  telegram: (ch, text) => ({
    url: `https://api.telegram.org/bot${ch.token}/sendMessage`,
    payload: { chat_id: ch.chatId, text },
  }),

  // Slack Incoming Webhook — dán URL webhook vào config
  slack: (ch, text) => ({
    url: ch.url,
    payload: { text },
  }),

  // Discord Webhook. Discord từ chối nếu thiếu "content".
  discord: (ch, text) => ({
    url: ch.url,
    payload: { content: text, username: ch.username || 'Pulse' },
  }),

  // Facebook Messenger Send API chính thức — cần Page access token và PSID
  // của người nhận (người đã inbox cho Page). https://developers.facebook.com
  messenger: (ch, text) => ({
    url: `https://graph.facebook.com/v21.0/me/messages?access_token=${ch.token}`,
    payload: { recipient: { id: ch.psid }, message: { text }, messaging_type: 'UPDATE' },
  }),

  // Zalo Official Account API chính thức — cần OA access token và user_id
  zalo: (ch, text) => ({
    url: 'https://openapi.zalo.me/v3.0/oa/message/cs',
    headers: { access_token: ch.token },
    payload: { recipient: { user_id: ch.userId }, message: { text } },
  }),

  // Webhook chung: gửi nguyên trạng thái dạng JSON để nối vào hệ thống khác
  webhook: (ch, text, ctx) => ({
    url: ch.url,
    headers: ch.headers,
    payload: { ...ctx, text },
  }),
};

/**
 * channels: mảng cấu hình, mỗi phần tử có `type` khớp một khoá trong CHANNELS.
 * Lỗi khi gửi được nuốt lại — cảnh báo hỏng thì không được làm sập vòng kiểm tra.
 */
export const notify = async (channels, monitor, result, isDown) => {
  const text = buildMessage(monitor, result, isDown);
  const ctx = {
    monitor: monitor.id,
    name: monitor.name || monitor.id,
    state: isDown ? 'down' : 'up',
    error: result.error,
    status: result.status,
    ms: result.ms,
    at: new Date().toISOString(),
  };

  const results = [];

  for (const ch of channels || []) {
    const build = CHANNELS[ch.type];
    if (!build) {
      results.push({ ok: false, error: `Kênh không hỗ trợ: ${ch.type}` });
      continue;
    }

    try {
      const { url, payload, headers } = build(ch, text, ctx);
      results.push(await post(url, payload, headers || {}));
    } catch (e) {
      results.push({ ok: false, error: e.message });
    }
  }

  return results;
};

export const SUPPORTED_CHANNELS = Object.keys(CHANNELS);

export const _internal = { buildMessage };
