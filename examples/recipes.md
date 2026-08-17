# Công thức cấu hình theo dịch vụ

Chép phần `monitors` bạn cần vào `monitors.json`. Đổi IP/host cho khớp.

Nguyên tắc chọn chu kỳ (nhắc lại): `interval` thấp bắt được sự cố ngắn nhưng
ồn hơn; `retries` cao tránh báo động giả do mạng chớp. Đề xuất chung cho
homelab: `interval: 15-30`, `retries: 2`.

---

## Stack WebUI_Film

Đúng hệ thống trong repo WebUI_Film. Backend và player là đường sống của việc
xem phim nên kiểm dày hơn.

```json
{
  "monitors": [
    {
      "id": "film-web",
      "name": "Web xem phim",
      "type": "http",
      "url": "http://192.168.100.169:6003/phimhay",
      "interval": 30,
      "retries": 2
    },
    {
      "id": "film-api",
      "name": "API",
      "type": "http",
      "url": "http://192.168.100.169:6001/v1/config/list",
      "interval": 20,
      "retries": 2,
      "keyword": "site"
    },
    {
      "id": "film-player",
      "name": "Trình phát",
      "type": "http",
      "url": "http://192.168.100.169:3013/play/",
      "interval": 30
    },
    {
      "id": "film-data",
      "name": "API còn ra được phim",
      "type": "http",
      "url": "http://192.168.100.169:6001/v1/movie/filterV2?limit=1",
      "interval": 60,
      "keyword": "items"
    }
  ]
}
```

Vì sao có `film-data` riêng: ở chế độ passthrough, backend vẫn sống nhưng **KKPhim
sập** là hết phim. Endpoint này chỉ xanh khi thật sự lấy được dữ liệu — bắt được
điểm chết mà `film-api` không thấy. `keyword: "items"` đảm bảo có nội dung thật
chứ không phải body rỗng.

Nếu chạy chế độ database, thêm MongoDB:

```json
{ "id": "film-mongo", "name": "MongoDB", "type": "tcp", "host": "192.168.100.169", "port": 27017, "interval": 60 }
```

---

## Nguồn phụ thuộc bên ngoài

Theo dõi chính KKPhim để biết khi nguồn sập — tách khỏi lỗi của mình.

```json
{ "id": "kkphim", "name": "Nguồn KKPhim", "type": "http", "url": "https://phimapi.com/the-loai", "interval": 300, "retries": 3 }
```

Chu kỳ 300s vì đây là dịch vụ người khác, kiểm dày là bất lịch sự và vô ích.

---

## Website public (HTTPS)

```json
{
  "id": "site",
  "name": "Website",
  "type": "http",
  "url": "https://example.com",
  "interval": 60,
  "retries": 2,
  "expectStatus": [200, 301, 302]
}
```

Chứng chỉ tự ký trong LAN thì thêm `"insecure": true`.

---

## Dịch vụ homelab thường gặp

```json
{
  "monitors": [
    { "id": "npm",       "name": "Nginx Proxy Manager", "type": "http", "url": "http://192.168.100.169:81",   "interval": 60 },
    { "id": "portainer", "name": "Portainer",           "type": "http", "url": "https://192.168.100.169:9443", "interval": 60, "insecure": true },
    { "id": "pihole",    "name": "Pi-hole",             "type": "http", "url": "http://192.168.100.169/admin", "interval": 60, "keyword": "Pi-hole" },
    { "id": "hass",      "name": "Home Assistant",      "type": "http", "url": "http://192.168.100.169:8123",  "interval": 60 },
    { "id": "jellyfin",  "name": "Jellyfin",            "type": "http", "url": "http://192.168.100.169:8096/health", "interval": 60 }
  ]
}
```

---

## Cổng thô (TCP) — không nói HTTP

Cho database, SSH, hoặc dịch vụ chỉ mở cổng.

```json
{
  "monitors": [
    { "id": "ssh",      "name": "SSH",        "type": "tcp", "host": "192.168.100.169", "port": 22,    "interval": 120 },
    { "id": "postgres", "name": "PostgreSQL", "type": "tcp", "host": "192.168.100.169", "port": 5432,  "interval": 60 },
    { "id": "redis",    "name": "Redis",      "type": "tcp", "host": "192.168.100.169", "port": 6379,  "interval": 60 },
    { "id": "mysql",    "name": "MySQL",      "type": "tcp", "host": "192.168.100.169", "port": 3306,  "interval": 60 }
  ]
}
```

TCP chỉ biết cổng có mở không, không biết dịch vụ bên trong có lành mạnh không.
Database có endpoint HTTP health thì ưu tiên dùng HTTP + keyword.

---

## Bắt lỗi nội dung, không chỉ mã trạng thái

`keyword` là thứ phân biệt "server trả 200" với "server thật sự chạy đúng".
Ví dụ trang trả 200 nhưng nội dung là trang lỗi:

```json
{
  "id": "app",
  "name": "App",
  "type": "http",
  "url": "http://192.168.100.169:8080",
  "keyword": "Đăng nhập",
  "interval": 30
}
```

Chỉ xanh khi trang có chữ "Đăng nhập" — mất chữ đó nghĩa là app hỏng dù HTTP vẫn 200.

---

## Bắt sự cố ngắn (blip vài chục giây)

```json
{ "id": "critical", "name": "Dịch vụ quan trọng", "type": "http", "url": "http://192.168.100.169:6001/v1/config/list", "interval": 10, "retries": 1 }
```

`interval: 10, retries: 1` bắt được sự cố từ ~10 giây, nhưng cũng nhạy với mọi
nhịp mạng. Chỉ dùng cho dịch vụ thật sự quan trọng, không dùng đại trà.
