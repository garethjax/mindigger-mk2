const ADJECTIVES = [
  "calmo", "rapido", "forte", "chiaro", "pronto", "gentile", "saggio", "sereno",
  "bravo", "saldo", "vivo", "fresco", "lieve", "solido", "agile", "fiero",
  "quieto", "corto", "lungo", "dolce", "acuto", "puro", "alto", "basso",
  "verde", "rosso", "blu", "giallo", "bianco", "nero", "misto", "nuovo",
];

const NOUNS = [
  "sole", "luna", "vento", "mare", "fiore", "campo", "ponte", "fiume",
  "pietra", "albero", "stella", "strada", "foglia", "nube", "fuoco", "bosco",
  "porto", "torre", "sasso", "riva", "onda", "prato", "cielo", "sentiero",
  "cuore", "segno", "notte", "giorno", "tempo", "luce", "carta", "vetro",
];

function randomInt(max: number): number {
  if (max <= 0) return 0;
  if (globalThis.crypto?.getRandomValues) {
    const array = new Uint32Array(1);
    globalThis.crypto.getRandomValues(array);
    return array[0] % max;
  }
  return Math.floor(Math.random() * max);
}

function randomDigits(length: number): string {
  let value = "";
  for (let i = 0; i < length; i += 1) {
    value += String(randomInt(10));
  }
  return value;
}

export function generatePassphrase(): string {
  const words = [
    ADJECTIVES[randomInt(ADJECTIVES.length)],
    NOUNS[randomInt(NOUNS.length)],
    ADJECTIVES[randomInt(ADJECTIVES.length)],
    NOUNS[randomInt(NOUNS.length)],
  ];

  return `${words.join("-")}-${randomDigits(3)}`;
}
