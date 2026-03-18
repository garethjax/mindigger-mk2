/**
 * Strip control characters from text.
 *
 * Removes ASCII control codes (0x00–0x08, 0x0B, 0x0C, 0x0E–0x1F, 0x7F)
 * while preserving tabs (0x09), newlines (0x0A), and carriage returns (0x0D).
 */
export function sanitize(text: string | null | undefined): string {
  if (!text) return "";
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}
