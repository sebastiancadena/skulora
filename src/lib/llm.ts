/**
 * Tiny provider adapter. Only what the planner and re-ranker need: "give me JSON matching this schema".
 * OpenAI Responses API with strict JSON-schema output; model configurable via OPENAI_MODEL.
 */

export type JsonSchema = Record<string, unknown>;

const OPENAI_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-5.4-mini";

export class LlmError extends Error {}

export async function generateJson<T>(opts: {
  name: string;
  schema: JsonSchema;
  system: string;
  user: string;
  signal?: AbortSignal;
  model?: string;
}): Promise<T> {
  const provider = process.env.LLM_PROVIDER || "openai";
  if (provider !== "openai") throw new LlmError(`LLM_PROVIDER=${provider} not implemented yet`);
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new LlmError("OPENAI_API_KEY missing");

  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: opts.model || process.env.OPENAI_MODEL || DEFAULT_MODEL,
      input: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
      text: { format: { type: "json_schema", name: opts.name, schema: opts.schema, strict: true } },
    }),
    signal: opts.signal,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new LlmError(`openai ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    output_text?: string;
    output?: { type: string; content?: { type: string; text?: string }[] }[];
  };
  const text =
    data.output_text ??
    data.output
      ?.flatMap((o) => o.content ?? [])
      .filter((c) => c.type === "output_text")
      .map((c) => c.text)
      .join("");
  if (!text) throw new LlmError("empty model output");
  return JSON.parse(text) as T;
}
