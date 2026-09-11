# Redact backend for a dstack (Phala) confidential VM.
FROM node:22-slim

WORKDIR /app

# Install production deps first so this layer caches across code changes.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Application code and the contract ABI. No .env, no data/.
COPY src ./src
COPY abi ./abi

EXPOSE 4021

CMD ["node", "src/server.js"]
