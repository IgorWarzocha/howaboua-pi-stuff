FROM oven/bun:1.4.2@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895 AS bun
FROM node:24-trixie-slim@sha256:173f125896c3b47ddf056734c7ea789d04595a6a08769a8f78e0df642781fb66
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN apt-get update && apt-get install -y --no-install-recommends bash ca-certificates git ripgrep python3 make g++ iproute2 kmod openssh-server procps util-linux e2fsprogs && rm -rf /var/lib/apt/lists/* /etc/ssh/ssh_host_*
RUN npm install -g @earendil-works/pi-coding-agent@1.0.4 @howaboua/pi-codex-conversion@3.0.46 && mkdir -p /workspace && chown node:node /workspace
COPY prepare.mjs /tmp/prepare.mjs
USER node
ENV HOME=/home/node PI_CODING_AGENT_DIR=/home/node/.pi/agent
WORKDIR /workspace
RUN pi install "$(npm root -g)/@howaboua/pi-codex-conversion" && node /tmp/prepare.mjs "$(npm root -g)/@howaboua/pi-codex-conversion"
CMD ["pi"]
