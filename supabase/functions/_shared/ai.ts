// One small interface over the user's own Claude or ChatGPT (OpenAI) API key.
// Every AI step in the app asks for structured JSON checked against a zod schema.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { z } from "zod";
// Loads zod at runtime: the SDK zod helpers need it as a peer, and the edge
// bundler only includes it when the function graph imports it directly.
import "zod";

export type AiProvider = "anthropic" | "openai";

export const DEFAULT_MODELS: Record<AiProvider, string> = {
  anthropic: "claude-opus-5-5",
  openai: "gpt-5",
};

export interface StructuredRequest<T> {
  /** Short name for the output, letters and underscores only. */
  name: string;
  system: string;
  user: string;
  schema: z.ZodType<T>;
}

export interface AiClient {
  provider: AiProvider;
  model: string;
  structured<T>(req: StructuredRequest<T>): Promise<T>;
}

/** The user's AI key was rejected (wrong, revoked, or out of credit). */
export class AiKeyError extends Error {}
/** The model declined or returned nothing usable. */
export class AiOutputError extends Error {}

function anthropicClient(apiKey: string, model: string): AiClient {
  const client = new Anthropic({ apiKey });
  return {
    provider: "anthropic",
    model,
    async structured<T>(req: StructuredRequest<T>): Promise<T> {
      try {
        const res = await client.beta.messages.parse({
          model,
          max_tokens: 16000,
          system: req.system,
          messages: [{ role: "user", content: req.user }],
          output_config: { effort: "low", format: betaZodOutputFormat(req.schema) },
          // If the model declines, the API retries on a fallback model in the same call.
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        });
        if (res.stop_reason === "refusal") {
          throw new AiOutputError(`The AI declined (${res.stop_details?.category ?? "no category"})`);
        }
        if (res.stop_reason === "max_tokens") throw new AiOutputError("The AI answer was cut off");
        if (res.parsed_output == null) throw new AiOutputError("The AI answer did not match the expected format");
        return res.parsed_output as T;
      } catch (err) {
        if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
          throw new AiKeyError("Your Claude API key was rejected");
        }
        if (err instanceof Anthropic.APIError && err.status === 402) throw new AiKeyError("Your Claude API account is out of credit");
        throw err;
      }
    },
  };
}

function openaiClient(apiKey: string, model: string): AiClient {
  const client = new OpenAI({ apiKey });
  return {
    provider: "openai",
    model,
    async structured<T>(req: StructuredRequest<T>): Promise<T> {
      try {
        const res = await client.responses.parse({
          model,
          instructions: req.system,
          input: req.user,
          store: false,
          text: { format: zodTextFormat(req.schema, req.name) },
        });
        if (res.output_parsed == null) throw new AiOutputError("The AI answer did not match the expected format");
        return res.output_parsed as T;
      } catch (err) {
        if (err instanceof OpenAI.AuthenticationError || err instanceof OpenAI.PermissionDeniedError) {
          throw new AiKeyError("Your OpenAI API key was rejected");
        }
        throw err;
      }
    },
  };
}

export function createAiClient(provider: AiProvider, apiKey: string, model?: string | null): AiClient {
  const m = model?.trim() || DEFAULT_MODELS[provider];
  return provider === "anthropic" ? anthropicClient(apiKey, m) : openaiClient(apiKey, m);
}

/** Cheap check that a pasted key works, used when the user saves it. */
export async function verifyKey(provider: AiProvider, apiKey: string): Promise<void> {
  try {
    if (provider === "anthropic") {
      await new Anthropic({ apiKey }).models.list({ limit: 1 });
    } else {
      await new OpenAI({ apiKey }).models.list();
    }
  } catch (err) {
    if (
      err instanceof Anthropic.AuthenticationError ||
      err instanceof Anthropic.PermissionDeniedError ||
      err instanceof OpenAI.AuthenticationError ||
      err instanceof OpenAI.PermissionDeniedError
    ) {
      throw new AiKeyError("That key was rejected. Check you copied the whole key.");
    }
    throw err;
  }
}
