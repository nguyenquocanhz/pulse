# Pulse — zero dependency, nên image cực nhỏ và không có bước cài đặt.
FROM node:22-alpine

WORKDIR /app

# Chỉ copy phần chạy. Không COPY . để tránh kéo theo data/ và monitors.json
# của người build vào image.
COPY package.json ./
COPY src ./src
COPY public ./public
COPY monitors.example.json ./

# Chạy bằng user không phải root
RUN addgroup -S app && adduser -S app -G app \
  && mkdir -p /app/data && chown -R app:app /app
USER app

EXPOSE 3001
VOLUME ["/app/data"]

# Config được mount vào lúc chạy:
#   docker run -v $PWD/monitors.json:/app/monitors.json:ro -v pulse-data:/app/data ...
# Không có monitors.json thì rơi về monitors.example.json để container vẫn khởi động.
#
# Healthcheck chỉ kiểm PULSE có phản hồi không, KHÔNG quan tâm status code.
# /healthz trả 503 khi dịch vụ ĐƯỢC GIÁM SÁT sập — lúc đó Pulse vẫn khỏe, không
# được đánh dấu container unhealthy. Bất kỳ phản hồi HTTP nào = Pulse sống.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3001/healthz',r=>{r.resume();process.exit(0)}).on('error',()=>process.exit(1))"

CMD ["sh", "-c", "node src/cli.js ${PULSE_CONFIG:-monitors.json} 2>/dev/null || node src/cli.js monitors.example.json"]
