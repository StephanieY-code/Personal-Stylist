#!/usr/bin/env bash
# Render build command:  bash render-build.sh
# Installs the backend, then builds the frontend into "Peak Style Personal Stylist/dist",
# which main.py serves at "/" so the website and the API share one URL.
set -euo pipefail

pip install -r requirements.txt

cd "Peak Style Personal Stylist"
npx --yes pnpm@9.15.9 install --frozen-lockfile
npx --yes pnpm@9.15.9 build
