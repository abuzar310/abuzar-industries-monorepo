import assert from "node:assert/strict";
import {
  chatCompletionsUrl,
  DEFAULT_AI_HOST,
  DEFAULT_GEMINI_MODEL,
  geminiGenerateUrl,
  geminiPaperModel,
  geminiPaperPlan,
  isGemini,
  isGeminiBusy,
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

// Paper reading: chosen model first, the fallback model next on the other key, no repeats.
assert.deepEqual(geminiPaperPlan("gemini-3.6-flash", ["k1", "k2", "k1", ""], ["gemini-3.5-flash", "gemini-3.6-flash"]), [
  { model: "gemini-3.6-flash", key: "k1" },
  { model: "gemini-3.5-flash", key: "k2" },
  { model: "gemini-3.6-flash", key: "k2" },
  { model: "gemini-3.5-flash", key: "k1" },
]);
assert.deepEqual(geminiPaperPlan("gpt-4o-mini", ["k1"], ["gemini-3.5-flash"]), [
  { model: DEFAULT_GEMINI_MODEL, key: "k1" },
  { model: "gemini-3.5-flash", key: "k1" },
]);
assert.deepEqual(geminiPaperPlan("gemini-3.6-flash", [], ["gemini-3.5-flash"]), []);
assert.equal(isGeminiBusy(503), true);
assert.equal(isGeminiBusy(429), true);
assert.equal(isGeminiBusy(500), true);
assert.equal(isGeminiBusy(0), true);
assert.equal(isGeminiBusy(400), false);
assert.equal(isGeminiBusy(403), false);
console.log("ai-host.check ok");
