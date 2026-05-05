# syntax=docker/dockerfile:1

FROM node:20.19.4-alpine
WORKDIR /workspace

RUN apk add --no-cache python3 libxml2-utils make build-base g++ git pkgconfig
RUN ln -sf python3 /usr/bin/python
ENV npm_config_python=/usr/bin/python3
ENV PYTHON=/usr/bin/python3
ENV ENV=node

COPY ./tsconfig*.json ./
COPY ./eslint.config.mjs ./
COPY package.json /workspace
COPY bun.lockb /workspace

RUN npm install -g bun
RUN bun install

CMD ["node"]
