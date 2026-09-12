import assert from "node:assert/strict";
import {
  chatCompletionsUrl,
  DEFAULT_AI_HOST,
  DEFAULT_GEMINI_MODEL,
  geminiGenerateUrl,
  geminiPaperModel,
  isGemini,
  isKintio,
  kintioMessagesUrl,
  normalizeAiHost,
  normalizeAiModel,
  textFromAnthropicSse,
  textFromGemini,
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
assert.equal(isGemini("", "AIzaSyxxxx"), true);
assert.equal(isGemini("", "AQ.xxxx"), true);
assert.equal(isGemini("https://generativelanguage.googleapis.com", ""), true);
assert.equal(isGemini("https://api.kintio.com", "sf_x"), false);
assert.equal(geminiPaperModel("gpt-4o-mini"), DEFAULT_GEMINI_MODEL);
assert.equal(geminiPaperModel("gemini-2.5-flash"), "gemini-2.5-flash");
assert.ok(geminiGenerateUrl("gemini-3.6-flash", "AIzaX").includes("/v1beta/models/gemini-3.6-flash:generateContent"));
assert.equal(textFromGemini({ candidates: [{ content: { parts: [{ text: " hi " }] } }] }), "hi");
console.log("ai-host.check ok");
