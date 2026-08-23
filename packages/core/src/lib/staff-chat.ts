import { listCached, prefGet, prefSet, put } from "./data";
import { nowIso, uid } from "./calc";
import { bumpData, getState, setChatUnseen } from "@/store/app-store";
import type { ChatMsg } from "./types";

export const DAY_UPDATE_DRAFT =
  "Day update please:\n- Cash in hand\n- UPI collections today\n- Any big dues or issues";

export function chatHref(draft?: string): string {
  if (!draft) return "/chat";
  return "/chat?draft=" + encodeURIComponent(draft);
}

const READ_KEY = "chatLastReadAt";

export function listChat(): ChatMsg[] {
  return listCached<ChatMsg>("chat").sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
}

export function refreshChatUnseen() {
  const me = getState().user;
  if (!me) {
    setChatUnseen(0);
    return;
  }
  const last = prefGet<string>(READ_KEY, "");
  const n = listChat().filter((m) => m.fromId !== me.id && (!last || (m.createdAt || "") > last)).length;
  setChatUnseen(n);
}

export function markChatRead() {
  prefSet(READ_KEY, nowIso());
  setChatUnseen(0);
}

export async function sendChat(text: string): Promise<ChatMsg | null> {
  const me = getState().user;
  const t = text.trim().slice(0, 2000);
  if (!me || !t) return null;
  const msg: ChatMsg = {
    id: "chat_" + uid(),
    fromId: me.id,
    fromName: me.name,
    fromRole: me.role,
    text: t,
    createdAt: nowIso(),
  };
  await put("chat", msg);
  bumpData();
  return msg;
}
