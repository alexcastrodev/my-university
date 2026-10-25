#!/bin/sh
# Keeps the hashed assets of the last few builds in the web image, so a tab opened before a deploy
# can still load its lazy chunks (and the KaTeX fonts they pull in) after the deploy replaces
# them. Without this, every deploy left such tabs with "Failed to fetch dynamically imported
# module" on their next navigation (Sentry UNIVERSITY-WEB-3/4); ChunkReloadService then reloaded
# the page, which still works as the backstop for tabs older than what is kept here.
#
# Usage: carry-previous-assets.sh HTML_DIR MANIFEST_DIR PREVIOUS_HTML_DIR PREVIOUS_MANIFEST_DIR KEEP
#
# Each build leaves a manifest (MANIFEST_DIR/<epoch>.txt) listing its own hashed assets. The new
# build takes the previous image's manifests, adds its own, keeps the newest KEEP, and copies
# back from the previous image every listed asset it doesn't already have. Filenames are content
# hashes, so a name present in both builds is the same file, and the oldest build's assets drop
# out as soon as its manifest does: the image holds KEEP builds' worth of assets, never more.
# A previous image without manifests (the first build with this script) gets one generated from
# its assets; an empty or missing PREVIOUS_HTML_DIR (local builds) carries nothing.
set -eu

html=$1
manifests=$2
previous_html=$3
previous_manifests=$4
keep=$5

list_assets() {
  (cd "$1" && find . -type f \( -name 'chunk-*.js' -o -path './media/*' -o -path './*/media/*' \)) | sort
}

mkdir -p "$manifests"
if [ -d "$previous_manifests" ]; then
  find "$previous_manifests" -maxdepth 1 -name '*.txt' -exec cp {} "$manifests/" \;
elif [ -d "$previous_html" ]; then
  list_assets "$previous_html" > "$manifests/0000000000.txt"
fi
list_assets "$html" > "$manifests/$(date +%s).txt"

# Epoch names are fixed-width, so a plain sort orders them by build time.
ls "$manifests" | sort -r | tail -n +"$((keep + 1))" | while read -r old; do
  rm "$manifests/$old"
done

carried=0
for path in $(cat "$manifests"/*.txt | sort -u); do
  [ -e "$html/$path" ] && continue
  [ -f "$previous_html/$path" ] || continue
  mkdir -p "$(dirname "$html/$path")"
  cp -p "$previous_html/$path" "$html/$path"
  carried=$((carried + 1))
done
echo "carry-previous-assets: kept $(ls "$manifests" | wc -l) build(s), carried $carried file(s) from the previous image"
