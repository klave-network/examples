# This file is generated by Nx.
#
# Build the docker image with `npx nx docker-build dispatcher`.
# Tip: Modify "docker-build" options in project.json to change docker build args.
#
# Run the container with `docker run -p 3000:3000 -t dispatcher`.
FROM docker.io/node:lts-alpine

ENV HOST=0.0.0.0
ENV PORT=3000

WORKDIR /app

RUN addgroup --system secret-mixing && \
    adduser --system -G secret-mixing secret-mixing

RUN yarn add serve
COPY dist/apps/secret-mixing secret-mixing
RUN chown -R secret-mixing:secret-mixing .

EXPOSE 3000
CMD [ "./node_modules/.bin/serve", "-s", "secret-mixing" ]
