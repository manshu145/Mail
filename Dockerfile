FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN npm install

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S neximail && adduser -S neximail -G neximail
COPY --from=builder --chown=neximail:neximail /app ./
USER neximail
EXPOSE 3000
CMD ["npm","run","start"]
