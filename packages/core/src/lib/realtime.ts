// Supabase Realtime — instant cross-device updates over WebSocket. On any row
// change in a synced table, we call back so the app can pull + refresh + notify
// immediately (no 20s poll wait). Uses the publishable key; RLS select for anon
// gates what changes are received.
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";

const TABLES = ["customers", "quotations", "invoices", "stock", "expenses", "sessions", "ledgers", "vouchers"];

let client: SupabaseClient | null = null;
let channel: RealtimeChannel | null = null;

export function startRealtime(
  url: string,
  key: string,
  prefix: string,
  onEvent: (store: string, eventType: string, oldId?: string) => void,
) {
  if (!url || !key || channel) return;
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { params: { eventsPerSecond: 20 } },
  });
  const ch = client.channel("app-sync");
  for (const t of TABLES) {
    ch.on("postgres_changes", { event: "*", schema: "public", table: (prefix || "") + t }, (payload) => {
      const old = payload.old as { id?: string } | undefined;
      onEvent(t, payload.eventType, old?.id);
    });
  }
  ch.subscribe();
  channel = ch;
}

export function stopRealtime() {
  try {
    if (client && channel) client.removeChannel(channel);
  } catch {}
  channel = null;
  client = null;
}
