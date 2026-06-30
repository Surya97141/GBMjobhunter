FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
# Background worker — no HTTP port. Communicates via BullMQ/Redis.
CMD ["node", "index.js"]
