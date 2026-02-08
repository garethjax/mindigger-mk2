/**
 * Build the system prompt for review analysis.
 * Categories are dynamic, fetched from the business sector.
 */
export function buildReviewSystemPrompt(
  sectorName: string,
  categoryNames: string[],
): string {
  const categoryList = categoryNames
    .map((c) => `"${c.toUpperCase().replace(/ /g, "_")}"`)
    .join(", ");

  return `You are an expert text analyzer for reviews about ${sectorName} sector.
Analyze the review and extract the following information in valid JSON format.

Rules:
1. italian_categories: Select up to 5 most relevant categories from the list provided. Do not invent new categories.
2. italian_topics: Generate up to 5 most relevant topics. Each italian_topic should have only one relation with one of categories from the list provided.
3. For each italian_topic, provide a score from 1 to 5
4. If the review is not in Italian, you MUST provide the 'italian_translation' field.
5. If the review title is not present, you MUST generate a title in Italian for the review.

Available categories: [${categoryList}]`;
}

/**
 * Build the user message for a single review analysis.
 */
export function buildReviewUserMessage(title: string, text: string): string {
  return `REVIEW: ${JSON.stringify({ title, text })}`;
}

/**
 * The JSON schema for structured output (review analysis).
 * Used by OpenAI's response_format parameter.
 */
export const REVIEW_ANALYSIS_SCHEMA = {
  type: "json_schema" as const,
  json_schema: {
    name: "review_analysis",
    strict: true,
    schema: {
      type: "object",
      properties: {
        italian_topics: {
          type: "array",
          items: {
            type: "object",
            properties: {
              italian_name: { type: "string" },
              score: { type: "integer", minimum: 1, maximum: 5 },
              italian_category: {
                type: "object",
                properties: {
                  name: { type: "string" },
                },
                required: ["name"],
                additionalProperties: false,
              },
            },
            required: ["italian_name", "score", "italian_category"],
            additionalProperties: false,
          },
        },
        sentiment: { type: "integer", minimum: 1, maximum: 5 },
        language: { type: "string" },
        italian_translation: {
          type: ["object", "null"],
          properties: {
            italian_title: { type: "string" },
            italian_text: { type: "string" },
          },
          required: ["italian_title", "italian_text"],
          additionalProperties: false,
        },
      },
      required: ["italian_topics", "sentiment", "language"],
      additionalProperties: false,
    },
  },
};

/**
 * System prompt for SWOT analysis.
 */
export const SWOT_SYSTEM_PROMPT = `Sei un esperto analista di business specializzato nella creazione di analisi SWOT (Strengths, Weaknesses, Opportunities, Threats) basate su recensioni di clienti.
Analizza attentamente le recensioni fornite ed estrai informazioni rilevanti per creare un'analisi SWOT completa e dettagliata in italiano.
Segui queste linee guida:

1. Identifica i punti di forza (Strengths) menzionati frequentemente nelle recensioni positive.
2. Identifica i punti deboli (Weaknesses) menzionati nelle recensioni negative o come suggerimenti di miglioramento.
3. Suggerisci opportunità (Opportunities) basate sui feedback dei clienti e sulle tendenze del mercato.
4. Identifica potenziali minacce (Threats) per l'attività basate sui feedback negativi e sul contesto competitivo.
5. Fornisci 5-8 spunti operativi concreti e attuabili basati sull'analisi SWOT.

Ogni punto deve essere una frase completa e significativa. Assicurati che i suggerimenti operativi siano specifici, attuabili e direttamente correlati ai punti identificati nell'analisi SWOT. Per ogni suggerimento operativo, fornisci un titolo conciso e una descrizione dettagliata.`;

/**
 * The JSON schema for structured output (SWOT analysis).
 */
export const SWOT_ANALYSIS_SCHEMA = {
  type: "json_schema" as const,
  json_schema: {
    name: "swot_analysis",
    strict: true,
    schema: {
      type: "object",
      properties: {
        strengths: {
          type: "object",
          properties: { points: { type: "array", items: { type: "string" } } },
          required: ["points"],
          additionalProperties: false,
        },
        weaknesses: {
          type: "object",
          properties: { points: { type: "array", items: { type: "string" } } },
          required: ["points"],
          additionalProperties: false,
        },
        opportunities: {
          type: "object",
          properties: { points: { type: "array", items: { type: "string" } } },
          required: ["points"],
          additionalProperties: false,
        },
        threats: {
          type: "object",
          properties: { points: { type: "array", items: { type: "string" } } },
          required: ["points"],
          additionalProperties: false,
        },
        operational_suggestions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              description: { type: "string" },
            },
            required: ["title", "description"],
            additionalProperties: false,
          },
        },
      },
      required: [
        "strengths",
        "weaknesses",
        "opportunities",
        "threats",
        "operational_suggestions",
      ],
      additionalProperties: false,
    },
  },
};
