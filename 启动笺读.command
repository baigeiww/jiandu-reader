#!/bin/zsh
set -e
cd -- "${0:A:h}"
if [[ -d 笺读.app ]]; then
  /usr/bin/open "$PWD/笺读.app"
  exit 0
fi
setopt null_glob
for runtime in "$PWD"/.runtime/node-*-darwin-*/bin; do
  export PATH="$runtime:$PATH"
done
if ! command -v node >/dev/null; then
  echo '请先安装 Node.js 22 或更新的 LTS 版本。'
  read '?按回车退出'
  exit 1
fi
if [[ ! -d node_modules ]]; then npm ci --no-audit --no-fund; fi
if [[ ! -f dist/index.html ]]; then npm run build; fi
node start-reader.cjs
