# Pulse

**Uptime monitoring trong một file. Không database. Không dependency.**

Kiểm tra dịch vụ, hiện status page, cảnh báo khi có sự cố — tất cả trong một tiến trình Node thuần. `git clone` xong chạy ngay, không cài gì.

```bash
git clone https://github.com/<ban>/pulse.git && cd pulse
cp monitors.example.json monitors.json
npm start
```

Mở `http://localhost:3001`.

- **Zero dependency** — chỉ core Node, không `npm install`
- **Không database** — lịch sử ghi NDJSON, tự cắt bớt
- **5 theme** — Slate, Midnight (OLED), Terminal, Nord, Sáng
- **Cảnh báo** — Telegram, Slack, Discord, Zalo, Messenger; chỉ báo khi đổi trạng thái
- **`/healthz`** — để dịch vụ ngoài giám sát chính Pulse

Toàn bộ mã đọc hết trong mười phút.

---

## Bên trong

- Không framework — status page là một file HTML tĩnh, đổi theme lưu localStorage
- Lưu trữ là file NDJSON mỗi monitor, không cần dịch vụ ngoài
- Chạy `node src/cli.js`, hoặc bỏ vào Docker/systemd tuỳ ý

---

## Cấu hình

Toàn bộ nằm trong một file JSON. Xem `monitors.example.json` để có bản đầy đủ.

### Monitor

```json
{
  "id": "api",
  "name": "API",
  "type": "http",
  "url": "http://192.168.1.50:6001/health",
  "interval": 30,
  "retries": 2,
  "keyword": "ok",
  "expectStatus": [200]
}
```

| Trường | Ý nghĩa |
|---|---|
| `id` | Bắt buộc, duy nhất. Dùng làm khoá lưu trữ. |
| `type` | `http` (mặc định) hoặc `tcp` |
| `url` | Cho HTTP |
| `host` + `port` | Cho TCP (database, SSH…) |
| `interval` | Giây giữa các lần kiểm tra (mặc định 60) |
| `retries` | Số lần thử trước khi coi là down (mặc định 1) |
| `keyword` | Chuỗi phải có trong nội dung. **Bắt được trường hợp server trả 200 nhưng nội dung hỏng** — thứ mà kiểm theo mã trạng thái hoàn toàn bỏ sót. |
| `expectStatus` | Mã HTTP coi là thành công (mặc định 2xx–3xx) |
| `insecure` | `true` để chấp nhận chứng chỉ tự ký |

### Kênh cảnh báo

Chỉ báo khi **đổi trạng thái** — đúng hai lần: lúc sập và lúc hồi phục. Không spam mỗi chu kỳ.

```json
"notifications": [
  { "type": "telegram", "token": "...", "chatId": "..." },
  { "type": "slack",    "url": "https://hooks.slack.com/services/..." },
  { "type": "discord",  "url": "https://discord.com/api/webhooks/..." }
]
```

| Kênh | Cần gì |
|---|---|
| `telegram` | Bot token + chat id |
| `slack` | Incoming Webhook URL |
| `discord` | Webhook URL |
| `zalo` | OA access token + user id |
| `messenger` | Page access token + PSID |
| `webhook` | URL bất kỳ, nhận JSON đầy đủ trạng thái |

---

## ⚠️ Lưu ý về Messenger và Zalo

Pulse gửi Messenger và Zalo qua **API chính thức**: Facebook Send API (cần Page + access token) và Zalo Official Account API (cần OA + access token).

**Cân nhắc kỹ nếu định gửi bằng cookie tài khoản cá nhân.** Có những thư viện gửi tin Messenger/Zalo bằng cách mượn cookie đăng nhập của bạn — Pulse cố ý không tích hợp cách này, và bạn nên thận trọng nếu tự làm:

- **Vi phạm điều khoản dịch vụ.** Facebook và Zalo đều cấm tự động hóa tài khoản cá nhân. Tài khoản có thể bị khóa, kể cả tài khoản chính bạn đang dùng hằng ngày.
- **Rất dễ vỡ.** Cookie hết hạn liên tục, và các endpoint nội bộ (`fb_dtsg`, graphql) đổi thường xuyên. Bot loại này chết vặt, mà một công cụ giám sát mà bản thân nó hay chết thì vô nghĩa.
- **Rủi ro bảo mật.** Cookie đăng nhập tương đương mật khẩu. Nhét vào file cấu hình hay repo là để lộ toàn bộ tài khoản.

Nếu vẫn muốn dùng cho tài khoản của riêng mình, hãy tự chịu rủi ro, để cookie ngoài repo, và đừng dùng tài khoản chính. Đường an toàn là tạo một Bot/OA riêng theo API chính thức.

---

## Endpoint

| Đường dẫn | Trả về |
|---|---|
| `/` | Trang trạng thái, tự làm mới 10 giây |
| `/api/status` | JSON toàn bộ trạng thái (CORS mở, nhúng được) |
| `/healthz` | `200` khi mọi thứ ổn, `503` khi có dịch vụ sập |

`/healthz` là để **giám sát chính Pulse từ bên ngoài**. Một dịch vụ uptime miễn phí bên ngoài (healthchecks.io, UptimeRobot…) chỉ cần theo dõi mỗi URL này là biết cả hệ thống — và quan trọng hơn, biết khi **chính máy chủ Pulse chết**, điều mà Pulse tự nó không thể tự báo.

---

## Chạy nền

### systemd

```ini
[Unit]
Description=Pulse
After=network.target

[Service]
WorkingDirectory=/opt/pulse
ExecStart=/usr/bin/node src/cli.js
Restart=always

[Install]
WantedBy=multi-user.target
```

### Docker

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY . .
EXPOSE 3001
CMD ["node", "src/cli.js"]
```

Không có `npm install` vì không có gì để cài.

---

## Biến môi trường

| Biến | Mặc định |
|---|---|
| `PULSE_PORT` | 3001 |
| `PULSE_DATA` | `./data` |

---

## Kiểm thử

```bash
npm test
```

13 test, không cần mạng: checker (dựng server thật để kiểm), lưu trữ, phân loại trạng thái, và logic chỉ-cảnh-báo-khi-đổi.

---

## Giới hạn — nên biết trước

- Lịch sử của một monitor được nạp vào bộ nhớ khi đọc. Mặc định giữ 2000 điểm/monitor (~vài trăm KB). Cần hàng triệu điểm thì đây không phải công cụ phù hợp.
- Cache và trạng thái cảnh báo nằm trong tiến trình. Chạy nhiều bản Pulse thì mỗi bản một trạng thái riêng.
- Kiểm tra chạy in-process. Hợp cho tới khoảng vài chục monitor; hàng trăm thì nên công cụ khác.

Pulse cố ý nhỏ. Nếu bạn cần nhiều hơn thế, Uptime Kuma là lựa chọn tốt.

---

## License

MIT
