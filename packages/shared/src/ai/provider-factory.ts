import type { AIProvider } from "./types";
import { OpenAIProvider } from "./openai-provider";
import { GeminiProvider } from "./gemini-provider";
import { OpenRouterProvider } from "./openrouter-provider";

/**
 * Shape of a row from the `ai_configs` table.
 */
interface AIConfigRow {
  provider: string;
  mode: string;
  model: string;
  config: Record<string, unknown>;
  is_active: boolean;
}

/**
 * Map of provider names to their API key environment variable names.
 */
const PROVIDER_ENV_KEYS: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

/**
 * Create an AIProvider instance from an ai_configs row.
 * Reads the API key from the environment.
 *
 * @param configRow - A row from the `ai_configs` table
 * @param env - Environment object (Deno.env or process.env compatible)
 */
export function createProvider(
  configRow: AIConfigRow,
  env: { get(key: string): string | undefined },
): AIProvider {
  const envKey = PROVIDER_ENV_KEYS[configRow.provider];
  if (!envKey) {
    throw new Error(`Unknown AI provider: ${configRow.provider}`);
  }

  const apiKey = env.get(envKey);
  if (!apiKey) {
    throw new Error(`Missing env var ${envKey} for provider ${configRow.provider}`);
  }

  switch (configRow.provider) {
    case "openai":
      return new OpenAIProvider(apiKey);
    case "gemini":
      return new GeminiProvider(apiKey);
    case "openrouter":
      return new OpenRouterProvider(apiKey);
    default:
      throw new Error(`Unknown AI provider: ${configRow.provider}`);
  }
}

/**
 * Convenience: get the active AI config and create a provider.
 * Designed for use in Edge Functions with Supabase admin client.
 */
export async function getActiveProvider(
  db: { from(table: string): any },
  env: { get(key: string): string | undefined },
): Promise<{ provider: AIProvider; config: AIConfigRow }> {
  const { data, error } = await db
    .from("ai_configs")
    .select("*")
    .eq("is_active", true)
    .single();

  if (error || !data) {
    throw new Error("No active AI config found");
  }

  const config = data as AIConfigRow;
  const provider = createProvider(config, env);

  return { provider, config };
}
