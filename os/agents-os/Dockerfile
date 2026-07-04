# Agents OS base image
#
# Build from repository root:
#   docker build -f os/agents-os/Dockerfile -t agents-os:dev --build-arg AGENTS_OS_CHANNEL=dev .
#
# This image is intentionally minimal: it contains the agents CLI runtime,
# Bun/Node/Python/Go toolchains, and the shared state mount contract. It does
# not bake in secrets, mutable operational data, or full submodule checkouts.

FROM ubuntu:24.04

ARG AGENTS_OS_VERSION=0.1.0
ARG AGENTS_OS_CHANNEL=dev
ARG AGENTS_OS_COMMIT=unknown
ARG AGENTS_OS_BUILT_AT=unknown
ARG BUN_VERSION=1.3.14
ARG NODE_VERSION=22
ARG GO_VERSION=1.24.4
ARG UV_VERSION=0.6.16

LABEL io.agents.os.managed="true" \
      io.agents.os.version="${AGENTS_OS_VERSION}" \
      io.agents.os.channel="${AGENTS_OS_CHANNEL}" \
      io.agents.os.commit="${AGENTS_OS_COMMIT}" \
      io.agents.os.built-at="${AGENTS_OS_BUILT_AT}"

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

# Base OS tools required by the distro contract and common package builds.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      git \
      openssh-client \
      unzip \
      bash \
      tini \
      build-essential \
      python3 \
      python3-pip \
      python3-venv \
      xz-utils \
 && rm -rf /var/lib/apt/lists/*

# Install Bun (primary CLI runtime).
RUN curl -fsSL https://bun.sh/install | bash -s "bun-v${BUN_VERSION}" \
 && mv /root/.bun/bin/bun /usr/local/bin/bun \
 && ln -s /usr/local/bin/bun /usr/local/bin/bunx \
 && rm -rf /root/.bun

# Install Node.js (LTS) for packages that require a Node runtime.
RUN curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

# Install Go for harness and runtime services.
RUN ARCH=$(dpkg --print-architecture) \
 && curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-${ARCH}.tar.gz" -o /tmp/go.tgz \
 && tar -C /usr/local -xzf /tmp/go.tgz \
 && rm /tmp/go.tgz

# Install uv for Python package management.
RUN ARCH=$(dpkg --print-architecture) \
 && curl -fsSL "https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-${ARCH}-unknown-linux-gnu.tar.gz" -o /tmp/uv.tgz \
 && tar -C /usr/local/bin -xzf /tmp/uv.tgz \
 && rm /tmp/uv.tgz

ENV PATH=/usr/local/go/bin:/usr/local/bin:${PATH}

# Create a non-root runtime user.
RUN groupadd -r agents -g 1000 \
 && useradd -r -m -g agents -u 1000 agents

# Copy the root repository into the read-only distro root.
WORKDIR /opt/agents-os
COPY . /opt/agents-os

# Install root dependencies (Bun/TypeScript tooling only).
RUN bun install --frozen-lockfile

# Drop submodule entries whose checkouts are not baked into this image so
# `agents doctor` validates only what the image actually contains.
RUN bun /opt/agents-os/os/agents-os/bin/filter-gitmodules.ts /opt/agents-os

# Expose the agents CLI through PATH.
RUN printf '#!/bin/sh\nexec bun /opt/agents-os/os/agents-manager/src/cli.ts "$@"\n' > /usr/local/bin/agents \
 && chmod +x /usr/local/bin/agents

# Shared state and workspace mount points. These are durable host paths.
RUN mkdir -p /agents/state /agents/data /workspace/agents /workspace/darkfactory \
 && chown -R agents:agents /agents /workspace

VOLUME ["/agents/state", "/agents/data", "/workspace/agents", "/workspace/darkfactory"]

# Container environment contract from docs/agents-os/DATA-CONTRACTS.md.
ENV AGENTS_ROOT=/opt/agents-os \
    AGENTS_HOME=/agents/state \
    AGENTS_DATA=/agents/data \
    AGENTS_WORKSPACE=/workspace/agents \
    AGENTOS_DATA_ROOT=/agents/data/agentos-data \
    DARKFACTORY_DATA_ROOT=/agents/data/darkfactory-data \
    DARK_FACTORY_WORKSPACE_ROOT=/workspace/darkfactory \
    AGENTS_DATA_REPOS=/agents/state/data-repos.json \
    AGENTS_PACKAGES=/agents/state/packages.json \
    AGENTS_CREDITS=/agents/state/credits.json \
    AGENTS_SECRETS=/agents/state/secrets \
    AGENTS_CLIS=/agents/state/clis \
    AGENTS_HARNESSES=/agents/state/harnesses \
    AGENTS_SKILLS=/agents/state/skills \
    AGENTS_PLUGINS=/agents/state/plugins \
    AGENTS_HOOKS=/agents/state/hooks \
    AGENTS_TEMPLATES=/agents/state/templates

USER agents

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["bash"]
