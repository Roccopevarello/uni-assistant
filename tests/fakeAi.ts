import type { AiClient, StructuredRequest } from "../supabase/functions/_shared/ai.ts";

/** AI stand-in: answers each named step from a handler and records every request. */
export function fakeAi(handlers: Record<string, (req: StructuredRequest<unknown>) => unknown>) {
  const calls: StructuredRequest<unknown>[] = [];
  const ai: AiClient = {
    provider: "anthropic",
    model: "fake",
    async structured<T>(req: StructuredRequest<T>): Promise<T> {
      calls.push(req as StructuredRequest<unknown>);
      const h = handlers[req.name];
      if (!h) throw new Error(`no fake for ${req.name}`);
      return req.schema.parse(h(req as StructuredRequest<unknown>));
    },
  };
  return { ai, calls };
}
