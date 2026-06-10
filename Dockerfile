# RuangTV Backend — build pakai Docker (hindari Nixpacks apt yang sering gagal)
FROM node:20-bookworm-slim

WORKDIR /app

# Install dependency dulu (cache layer) — semua dep pure-JS, tak butuh apt tambahan
COPY package*.json ./
RUN npm install --omit=dev

# Salin sisa kode
COPY . .

ENV NODE_ENV=production
# Railway inject PORT otomatis; server.js fallback ke 3001
EXPOSE 3001

CMD ["node", "server.js"]
