#!/usr/bin/env bash
# Create all tables + RLS policies in the Supabase project.
# Get the URI from: Supabase → Project Settings → Database → Connection string → URI
# Usage:  SUPABASE_DB_URL='postgresql://postgres:...@...supabase.com:5432/postgres' bash scripts/db-setup.sh
set -euo pipefail
: "${SUPABASE_DB_URL:?Set SUPABASE_DB_URL to the Supabase Postgres connection string}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$DIR/db/setup.sql"
echo "✓ Schema ready — restart the dev servers so .env.local loads, then sync will work."
