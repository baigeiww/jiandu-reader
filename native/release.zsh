#!/bin/zsh
set -eu
cd "${0:A:h:h}"
[[ "$(uname -m)" == arm64 ]] || { print -u2 '当前发布包需要在 Apple Silicon Mac 上构建'; exit 1; }
node -e 'if (process.versions.node.split(".")[0] !== "22" || process.arch !== "arm64") process.exit(1)' || {
  print -u2 '请使用 Apple Silicon 版 Node.js 22'; exit 1
}
version=$(node -p 'JSON.parse(require("node:fs").readFileSync("package.json","utf8")).version')
destination="$PWD/output/releases/v$version"
mkdir -p "$destination"
image="$destination/Jiandu-$version-macOS-arm64.dmg"
[[ ! -e "$image" ]] || { print -u2 "发布包已存在，请先移开 $image"; exit 1; }
stage=$(mktemp -d "$PWD/output/releases/.stage.XXXXXXXX")
trap 'rm -rf "$stage"' EXIT
native/build.zsh "$stage/笺读.app"
codesign --verify --deep --strict "$stage/笺读.app"
[[ "$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$stage/笺读.app/Contents/Info.plist")" == "$version" ]] || {
  print -u2 '应用版本与 package.json 不一致'; exit 1
}
file "$stage/笺读.app/Contents/Resources/node" | grep -q arm64
ln -s /Applications "$stage/Applications"
cp native/安装说明.txt "$stage/安装说明.txt"
hdiutil create -volname "笺读 $version" -srcfolder "$stage" -format UDZO -o "$image"
cd "$destination"
shasum -a 256 "${image:t}" > SHA256SUMS.txt
print "发布包已生成 $image"
