FROM node:20

ENV NODE_ENV=production

WORKDIR /usr/src/app

RUN chown node /usr/src/app

RUN apt-get update && apt-get install -y iputils-ping less nano build-essential

RUN chown node .

USER node

RUN mkdir -p log

COPY --chown=node . .

RUN yarn install --frozen-lockfile; yarn build; yarn cache clean;