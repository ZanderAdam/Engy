import { mkdir, writeFile, access } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';

export interface ConfigGeneratorOptions {
  docsDir: string;
  repos: string[];
  containerConfig?: {
    allowedDomains?: string[];
    extraPackages?: string[];
    envVars?: Record<string, string>;
    idleTimeout?: number;
  };
}

export function rewriteLocalhostUrls(envVars: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(envVars)) {
    result[key] = value.replace(
      /^(https?:\/\/)localhost(:\d+.*)$/,
      '$1host.docker.internal$2',
    );
  }
  return result;
}

export function devcontainerJsonContent(options: ConfigGeneratorOptions): object {
  const { docsDir, repos, containerConfig } = options;

  const resolvedDocsDir = resolve(docsDir);
  const repoMounts = repos
    .filter((repo, index, arr) => {
      const resolvedRepo = resolve(repo);
      const rel = relative(resolvedDocsDir, resolvedRepo);
      if (resolvedRepo === resolvedDocsDir || (!rel.startsWith('..') && !rel.startsWith('/'))) {
        return false;
      }
      return arr.indexOf(repo) === index;
    })
    .map((repo) => `source=${repo},target=${repo},type=bind`);

  const mounts = [
    ...repoMounts,
    'source=${localEnv:HOME}/.claude,target=/home/node/.claude,type=bind',
  ];

  const defaultEnv: Record<string, string> = {
    NODE_OPTIONS: '--max-old-space-size=4096',
    DEVCONTAINER: 'true',
  };

  const userEnv = containerConfig?.envVars ? rewriteLocalhostUrls(containerConfig.envVars) : {};
  const containerEnv = { ...defaultEnv, ...userEnv };

  return {
    name: 'Engy Sandbox',
    build: {
      dockerfile: 'Dockerfile',
      args: {
        TZ: '${localEnv:TZ:America/Los_Angeles}',
        CLAUDE_CODE_VERSION: 'latest',
        GIT_DELTA_VERSION: '0.18.2',
        ZSH_IN_DOCKER_VERSION: '1.2.0',
      },
    },
    runArgs: ['--cap-add=NET_ADMIN', '--cap-add=NET_RAW'],
    remoteUser: 'node',
    workspaceMount: `source=${docsDir},target=${docsDir},type=bind`,
    workspaceFolder: docsDir,
    mounts,
    containerEnv,
    postStartCommand: 'sudo /usr/local/bin/init-firewall.sh',
    waitFor: 'postStartCommand',
  };
}

export function dockerfileContent(extraPackages?: string[]): string {
  const basePackages = [
    'less',
    'git',
    'procps',
    'sudo',
    'fzf',
    'zsh',
    'man-db',
    'unzip',
    'gnupg2',
    'gh',
    'iptables',
    'ipset',
    'iproute2',
    'dnsutils',
    'aggregate',
    'jq',
    'nano',
    'vim',
  ];

  const allPackages = extraPackages ? [...basePackages, ...extraPackages] : basePackages;
  const packageList = allPackages.map((p) => `  ${p}`).join(' \\\n');

  return `FROM node:20

ARG TZ
ENV TZ="$TZ"

ARG CLAUDE_CODE_VERSION=latest

# Install basic development tools and iptables/ipset
RUN apt-get update && apt-get install -y --no-install-recommends \\
${packageList} \\
  && apt-get clean && rm -rf /var/lib/apt/lists/*

# Ensure default node user has access to /usr/local/share
RUN mkdir -p /usr/local/share/npm-global && \\
  chown -R node:node /usr/local/share

ARG USERNAME=node

# Persist bash history.
RUN SNIPPET="export PROMPT_COMMAND='history -a' && export HISTFILE=/commandhistory/.bash_history" \\
  && mkdir /commandhistory \\
  && touch /commandhistory/.bash_history \\
  && chown -R $USERNAME /commandhistory

# Set \`DEVCONTAINER\` environment variable to help with orientation
ENV DEVCONTAINER=true

# Create workspace and config directories and set permissions
RUN mkdir -p /workspace /home/node/.claude && \\
  chown -R node:node /workspace /home/node/.claude

WORKDIR /workspace

ARG GIT_DELTA_VERSION=0.18.2
RUN ARCH=$(dpkg --print-architecture) && \\
  wget "https://github.com/dandavison/delta/releases/download/\${GIT_DELTA_VERSION}/git-delta_\${GIT_DELTA_VERSION}_\${ARCH}.deb" && \\
  sudo dpkg -i "git-delta_\${GIT_DELTA_VERSION}_\${ARCH}.deb" && \\
  rm "git-delta_\${GIT_DELTA_VERSION}_\${ARCH}.deb"

# Set up non-root user
USER node

# Install global packages
ENV NPM_CONFIG_PREFIX=/usr/local/share/npm-global
ENV PATH=$PATH:/usr/local/share/npm-global/bin

# Set the default shell to zsh rather than sh
ENV SHELL=/bin/zsh

# Set the default editor and visual
ENV EDITOR=nano
ENV VISUAL=nano

# Default powerline10k theme
ARG ZSH_IN_DOCKER_VERSION=1.2.0
RUN sh -c "$(wget -O- https://github.com/deluan/zsh-in-docker/releases/download/v\${ZSH_IN_DOCKER_VERSION}/zsh-in-docker.sh)" -- \\
  -p git \\
  -p fzf \\
  -a "source /usr/share/doc/fzf/examples/key-bindings.zsh" \\
  -a "source /usr/share/doc/fzf/examples/completion.zsh" \\
  -a "export PROMPT_COMMAND='history -a' && export HISTFILE=/commandhistory/.bash_history" \\
  -x

# Install Claude
RUN npm install -g @anthropic-ai/claude-code@\${CLAUDE_CODE_VERSION}

# Copy and set up firewall script
COPY init-firewall.sh /usr/local/bin/
USER root
RUN chmod +x /usr/local/bin/init-firewall.sh && \\
  echo "node ALL=(root) NOPASSWD: /usr/local/bin/init-firewall.sh" > /etc/sudoers.d/node-firewall && \\
  chmod 0440 /etc/sudoers.d/node-firewall
USER node
`;
}

export function firewallScriptContent(allowedDomains?: string[]): string {
  const defaultDomains = [
    'registry.npmjs.org',
    'api.anthropic.com',
    'sentry.io',
    'statsig.anthropic.com',
    'statsig.com',
    'marketplace.visualstudio.com',
    'vscode.blob.core.windows.net',
    'update.code.visualstudio.com',
  ];

  const allDomains = allowedDomains ? [...defaultDomains, ...allowedDomains] : defaultDomains;

  const domainEntries = allDomains.map((d) => `    "${d}"`).join(' \\\n');

  return `#!/bin/bash
set -euo pipefail  # Exit on error, undefined vars, and pipeline failures
IFS=$'\\n\\t'       # Stricter word splitting

# 1. Extract Docker DNS info BEFORE any flushing
DOCKER_DNS_RULES=$(iptables-save -t nat | grep "127\\.0\\.0\\.11" || true)

# Flush existing rules and delete existing ipsets
iptables -F
iptables -X
iptables -t nat -F
iptables -t nat -X
iptables -t mangle -F
iptables -t mangle -X
ipset destroy allowed-domains 2>/dev/null || true

# 2. Selectively restore ONLY internal Docker DNS resolution
if [ -n "$DOCKER_DNS_RULES" ]; then
    echo "Restoring Docker DNS rules..."
    iptables -t nat -N DOCKER_OUTPUT 2>/dev/null || true
    iptables -t nat -N DOCKER_POSTROUTING 2>/dev/null || true
    echo "$DOCKER_DNS_RULES" | xargs -L 1 iptables -t nat
else
    echo "No Docker DNS rules to restore"
fi

# First allow DNS and localhost before any restrictions
# Allow outbound DNS
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
# Allow inbound DNS responses
iptables -A INPUT -p udp --sport 53 -j ACCEPT
# Allow outbound SSH
iptables -A OUTPUT -p tcp --dport 22 -j ACCEPT
# Allow inbound SSH responses
iptables -A INPUT -p tcp --sport 22 -m state --state ESTABLISHED -j ACCEPT
# Allow localhost
iptables -A INPUT -i lo -j ACCEPT
iptables -A OUTPUT -o lo -j ACCEPT

# Create ipset with CIDR support
ipset create allowed-domains hash:net

# Fetch GitHub meta information and aggregate + add their IP ranges
echo "Fetching GitHub IP ranges..."
gh_ranges=$(curl -s https://api.github.com/meta)
if [ -z "$gh_ranges" ]; then
    echo "ERROR: Failed to fetch GitHub IP ranges"
    exit 1
fi

if ! echo "$gh_ranges" | jq -e '.web and .api and .git' >/dev/null; then
    echo "ERROR: GitHub API response missing required fields"
    exit 1
fi

echo "Processing GitHub IPs..."
while read -r cidr; do
    if [[ ! "$cidr" =~ ^[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}/[0-9]{1,2}$ ]]; then
        echo "ERROR: Invalid CIDR range from GitHub meta: $cidr"
        exit 1
    fi
    echo "Adding GitHub range $cidr"
    ipset add allowed-domains "$cidr"
done < <(echo "$gh_ranges" | jq -r '(.web + .api + .git)[]' | aggregate -q)

# Resolve and add other allowed domains
for domain in \\
${domainEntries}; do
    echo "Resolving $domain..."
    ips=$(dig +noall +answer A "$domain" | awk '$4 == "A" {print $5}')
    if [ -z "$ips" ]; then
        echo "ERROR: Failed to resolve $domain"
        exit 1
    fi

    while read -r ip; do
        if [[ ! "$ip" =~ ^[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}$ ]]; then
            echo "ERROR: Invalid IP from DNS for $domain: $ip"
            exit 1
        fi
        echo "Adding $ip for $domain"
        ipset add allowed-domains "$ip"
    done < <(echo "$ips")
done

# Get host IP from default route
HOST_IP=$(ip route | grep default | cut -d" " -f3)
if [ -z "$HOST_IP" ]; then
    echo "ERROR: Failed to detect host IP"
    exit 1
fi

HOST_NETWORK=$(echo "$HOST_IP" | sed "s/\\.[0-9]*$/.0\\/24/")
echo "Host network detected as: $HOST_NETWORK"

# Set up remaining iptables rules
iptables -A INPUT -s "$HOST_NETWORK" -j ACCEPT
iptables -A OUTPUT -d "$HOST_NETWORK" -j ACCEPT

# Set default policies to DROP first
iptables -P INPUT DROP
iptables -P FORWARD DROP
iptables -P OUTPUT DROP

# First allow established connections for already approved traffic
iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# Then allow only specific outbound traffic to allowed domains
iptables -A OUTPUT -m set --match-set allowed-domains dst -j ACCEPT

# Explicitly REJECT all other outbound traffic for immediate feedback
iptables -A OUTPUT -j REJECT --reject-with icmp-admin-prohibited

echo "Firewall configuration complete"
echo "Verifying firewall rules..."
if curl --connect-timeout 5 https://example.com >/dev/null 2>&1; then
    echo "ERROR: Firewall verification failed - was able to reach https://example.com"
    exit 1
else
    echo "Firewall verification passed - unable to reach https://example.com as expected"
fi

# Verify GitHub API access
if ! curl --connect-timeout 5 https://api.github.com/zen >/dev/null 2>&1; then
    echo "ERROR: Firewall verification failed - unable to reach https://api.github.com"
    exit 1
else
    echo "Firewall verification passed - able to reach https://api.github.com as expected"
fi
`;
}

export async function generateDevcontainerConfig(options: ConfigGeneratorOptions): Promise<void> {
  const devcontainerDir = join(options.docsDir, '.devcontainer');

  try {
    await access(devcontainerDir);
    return;
  } catch {
    // expected when directory doesn't exist yet
  }

  await mkdir(devcontainerDir, { recursive: true });

  const json = devcontainerJsonContent(options);
  const dockerfile = dockerfileContent(options.containerConfig?.extraPackages);
  const firewall = firewallScriptContent(options.containerConfig?.allowedDomains);

  await writeFile(join(devcontainerDir, 'devcontainer.json'), JSON.stringify(json, null, 2) + '\n');
  await writeFile(join(devcontainerDir, 'Dockerfile'), dockerfile);
  await writeFile(join(devcontainerDir, 'init-firewall.sh'), firewall, { mode: 0o755 });
}
