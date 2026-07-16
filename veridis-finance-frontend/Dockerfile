# Frontend dev-mode image for the one-command local stack.
#
# Runs `next dev` so cookies are set without the `secure` flag (they are only
# secure in production) and work over plain http://localhost:3000. This is a
# local test harness, not a production image.
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

ENV NODE_ENV=development
EXPOSE 3000

CMD ["npm", "run", "dev", "--", "-H", "0.0.0.0"]
