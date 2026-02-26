FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY src ./src
COPY config ./config
COPY middleware ./middleware
COPY routes ./routes
COPY services ./services
COPY utils ./utils

EXPOSE 3001
CMD ["npm", "start"]
