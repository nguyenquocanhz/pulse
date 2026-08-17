import http from 'node:http';
import https from 'node:https';
import { _internal } from './checker.js';

const { checkHttp } = _internal;

/**
 * Journey check — ping cả một luồng nhiều bước theo thứ tự, đo latency từng chặng.
 *
 * Đây là "tracing từ ngoài vào": thay vì ping từng endpoint rời rạc, ta đi qua
 * đúng hành trình người dùng và thấy chặng nào chậm/hỏng — gần như đọc một trace
 * của microservice, nhưng KHÔNG phải nhúng gì vào service.
 *
 * Sức mạnh nằm ở chỗ nối chuỗi: bước sau dùng được giá trị TRÍCH từ bước trước
 * (token, id...), đúng như một request thật đi qua các service phụ thuộc nhau.
 *
 *   steps: [
 *     { name: "Danh sách", url: "...", keyword: "items",
 *       extract: { movieId: { json: "result.items.0.public_id" } } },
 *     { name: "Lấy link", url: ".../getLink?movie_id={{movieId}}" }
 *   ]
 */

/** Lấy giá trị theo đường dẫn "a.b.0.c" từ object (hỗ trợ index mảng). */
const getJsonPath = (obj, path) => {
  let cur = obj;
  for (const part of String(path).split('.')) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
};

/** Thay {{var}} trong chuỗi bằng giá trị đã trích ở các bước trước. */
const interpolate = (str, vars) =>
  String(str).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) =>
    vars[k] !== undefined ? encodeURIComponent(vars[k]) : `{{${k}}}`,
  );

/** Trích các biến từ body/response của một bước, cho bước sau dùng. */
const extractVars = (extract, body) => {
  const out = {};
  if (!extract) return out;

  let parsed;
  for (const [name, rule] of Object.entries(extract)) {
    try {
      if (rule.json) {
        if (parsed === undefined) parsed = JSON.parse(body);
        out[name] = getJsonPath(parsed, rule.json);
      } else if (rule.regex) {
        const m = body.match(new RegExp(rule.regex));
        out[name] = m ? (m[1] ?? m[0]) : undefined;
      }
    } catch {
      out[name] = undefined;
    }
  }
  return out;
};

/**
 * Chạy một journey. Trả về hình dạng TƯƠNG THÍCH với runCheck
 * ({ok, status, ms, error}) cộng thêm mảng `steps` để hiển thị chi tiết.
 *
 * Dừng ngay ở bước đầu tiên hỏng — giống một request thật: chặng trước gãy thì
 * chặng sau không có gì để chạy.
 */
export const runJourney = async (monitor) => {
  const started = Date.now();
  const steps = [];
  const vars = {};

  for (const [i, step] of (monitor.steps || []).entries()) {
    const url = interpolate(step.url, vars);

    // mỗi bước là một check HTTP, thừa hưởng keyword/expectStatus/timeout
    const res = await checkHttp({
      ...step,
      url,
      timeout: step.timeout ?? monitor.stepTimeout ?? 10000,
    });

    const stepResult = {
      name: step.name || `Bước ${i + 1}`,
      ok: res.ok,
      status: res.status,
      ms: res.ms,
    };
    if (res.error) stepResult.error = res.error;
    steps.push(stepResult);

    if (!res.ok) {
      // dừng chuỗi tại đây, báo rõ hỏng ở chặng nào
      return {
        ok: false,
        status: res.status,
        ms: Date.now() - started,
        error: `Hỏng ở "${stepResult.name}": ${res.error || `HTTP ${res.status}`}`,
        steps,
      };
    }

    // trích biến cho bước sau (cần body -> gọi lại có giữ body)
    if (step.extract) {
      const withBody = await fetchBody(url, step);
      Object.assign(vars, extractVars(step.extract, withBody));
    }
  }

  return {
    ok: true,
    status: 200,
    ms: Date.now() - started,
    error: null,
    steps,
  };
};

/**
 * checkHttp không trả body ra ngoài (cố ý, để nhẹ). Khi bước có `extract` ta cần
 * body, nên gọi riêng một lần lấy body. Đánh đổi: bước có extract tốn 2 request.
 * Chấp nhận được vì journey chạy theo chu kỳ dài, không phải đường nóng.
 */
const fetchBody = (url, step) =>
  new Promise((resolve) => {
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.request(
      url,
      { method: step.method || 'GET', timeout: step.timeout ?? 10000 },
      (res) => {
        let data = '';
        res.on('data', (c) => {
          if (data.length < 262144) data += c; // giới hạn 256KB
        });
        res.on('end', () => resolve(data));
      },
    );
    req.on('error', () => resolve(''));
    req.on('timeout', () => {
      req.destroy();
      resolve('');
    });
    req.end();
  });

export const _internal_journey = { getJsonPath, interpolate, extractVars };
