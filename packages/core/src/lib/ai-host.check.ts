import assert from "node:assert/strict";
import {
  chatCompletionsUrl,
  DEFAULT_AI_HOST,
  isKintio,
  kintioMessagesUrl,
  normalizeAiHost,
  normalizeAiModel,
  textFromAnthropicSse,
} from "./ai-host.ts";

assert.equal(normalizeAiHost(""), DEFAULT_AI_HOST);
assert.equal(normalizeAiHost("   "), DEFAULT_AI_HOST);
assert.equal(normalizeAiHost("https://api.openai.com/v1/"), "https://api.openai.com/v1");
assert.equal(normalizeAiHost("https://openrouter.ai/api/v1"), "https://openrouter.ai/api/v1");
assert.equal(normalizeAiHost("http://127.0.0.1:11434/v1"), "http://127.0.0.1:11434/v1");
assert.equal(normalizeAiHost("not a url"), null);
assert.equal(normalizeAiHost("ftp://x"), null);
assert.equal(chatCompletionsUrl("https://api.openai.com/v1"), "https://api.openai.com/v1/chat/completions");
assert.equal(
  chatCompletionsUrl("https://api.openai.com/v1/chat/completions"),
  "https://api.openai.com/v1/chat/completions",
);
assert.equal(normalizeAiModel(""), "gpt-4o-mini");
assert.equal(normalizeAiModel(" llama-3.1-8b-instant "), "llama-3.1-8b-instant");
assert.equal(isKintio("https://api.kintio.com"), true);
assert.equal(isKintio("https://api.openai.com/v1", "sf_abc"), true);
assert.equal(isKintio("https://api.openai.com/v1", "sk-x"), false);
assert.equal(kintioMessagesUrl("https://api.kintio.com"), "https://api.kintio.com/v1/messages");
assert.equal(kintioMessagesUrl("https://api.openai.com/v1"), "https://api.kintio.com/v1/messages");
assert.equal(
  textFromAnthropicSse('event: ping\ndata: {"type":"content_block_delta","delta":{"text":"PO"}}\ndata: {"delta":{"text":"NG"}}\n'),
  "PONG",
);
console.log("ai-host.check ok");
