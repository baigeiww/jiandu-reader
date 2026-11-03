#!/bin/zsh
set -eu
cd "${0:A:h:h}"
target="${1:-$PWD/笺读.app}"
[[ ! -e "$target" ]] || { print -u2 "请先移开现有的 $target"; exit 1; }
contents="$target/Contents"
res="$contents/Resources"
mkdir -p "$contents/MacOS" "$res"
clang -fobjc-arc -O2 -mmacosx-version-min=13.0 -framework Cocoa -framework WebKit native/main.m -o "$contents/MacOS/Reader"
cp native/Reader.icns "$res/"
cp native/Info.plist "$contents/Info.plist"
cp -R dist/. "$res/dist"
mkdir -p "$res/licenses"
cp native/licenses/* "$res/licenses/"
cp dist-server/app.cjs native/service.cjs "$res/"
node_binary=$(node -p "process.execPath")
cp "$node_binary" "$res/node"
node_modules/.bin/esbuild src/backup.ts --bundle --minify --global-name=ReaderTransfer --outfile="$res/transfer.js"
codesign --force --sign - "$target"
