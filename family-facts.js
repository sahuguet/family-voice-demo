// Shared, made-up family knowledge base used by both voice-agent demos.
// Swap getFamilyFacts() for a real lookup or RAG call outside of demo use.

const FAMILY_SYSTEM_PROMPT =
  "Tu es un compagnon vocal chaleureux et patient qui a une conversation " +
  "décontractée avec un grand parent qui s'appelle Marcel qui vit à Paris. Réponds toujours en français, avec des " +
  "phrases courtes et simples. Chaque fois que la conversation touche aux " +
  "enfants Léa et Noah, à leurs activités, ou aux projets du week-end, " +
  "appelle get_family_facts avant de répondre, puis intègre naturellement " +
  "les informations obtenues dans ta réponse orale. Si on te demande la " +
  "date ou l'heure, utilise uniquement la date du jour donnée ci-dessous - " +
  "ne devine jamais. Pour toute question sur l'actualité ou des faits " +
  "récents que tu ne connais pas avec certitude, appelle web_search avant " +
  "de répondre plutôt que de deviner.";

// The model has no clock of its own - it only knows this if we tell it,
// every session, in its own words. Recomputed on each call, never cached.
function getCurrentDateContext() {
  const formatted = new Date().toLocaleDateString("fr-FR", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  return `Nous sommes aujourd'hui le ${formatted}.`;
}

function buildSystemPrompt() {
  return `${FAMILY_SYSTEM_PROMPT} ${getCurrentDateContext()}`;
}

const WEB_SEARCH_TOOL = {
  type: "function",
  name: "web_search",
  description:
    "Search the web for current information - news, weather, sports " +
    "scores, or anything that may have changed since training. Call this " +
    "instead of guessing whenever you're not certain of a recent fact.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The search query, in French or English.",
      },
    },
    required: ["query"],
  },
};

const FAMILY_TOOL = {
  type: "function",
  name: "get_family_facts",
  description:
    "Look up facts about the user's family, kids, and weekend plans. Call " +
    "this whenever the conversation touches on Léa, Noah, their " +
    "activities (soccer, rock climbing, the pool), restaurants, or weekend plans.",
  parameters: {
    type: "object",
    properties: {
      topic: {
        type: "string",
        description:
          "What the conversation touched on, e.g. 'lea', 'noah', " +
          "'foot'/'soccer', 'escalade'/'climbing', 'piscine'/'pool', " +
          "'restaurant', 'weekend', or 'general'.",
      },
    },
    required: ["topic"],
  },
};

const FAMILY_FACTS = {
  lea: [
    "Léa a son cours d'escalade samedi à 11h, à la salle de grimpe.",
    "Léa vient de passer à une voie plus difficile, une 5.7, et elle a hâte d'y retourner.",
    "Léa a demandé à retourner à la salle d'escalade dimanche aussi.",
  ],
  noah: [
    "Noah a son entraînement de foot samedi à 9h avec son équipe, les Comètes.",
    "Noah a marqué le but de la victoire au dernier match et il en est très fier.",
    "Noah a envie de jouer au foot dans le jardin avec toi dimanche après-midi.",
  ],
  climbing: [
    "Le cours d'escalade de Léa est samedi à 11h, juste après l'entraînement de foot de Noah.",
    "Léa est passée à une voie de niveau 5.7 à la salle d'escalade.",
  ],
  soccer: [
    "L'entraînement de foot de Noah est samedi à 9h avec son équipe, les Comètes.",
    "Noah a marqué le but de la victoire au dernier match.",
  ],
  pool: [
    "La famille va à la piscine samedi après-midi, juste après le foot et l'escalade.",
    "Léa et Noah adorent faire des concours de plongeon à la piscine.",
  ],
  restaurant: [
    "La famille a réservé samedi soir dans leur restaurant vietnamien préféré.",
    "Léa et Noah adorent les rouleaux de printemps là-bas et se débrouillent de mieux en mieux avec les baguettes.",
  ],
  weekend: [
    "Samedi : Noah a foot à 9h, Léa a escalade à 11h, puis la famille va à la piscine, puis dîner vietnamien le soir.",
    "Dimanche : petit-déjeuner pancakes, balade à vélo en famille à midi, foot dans le jardin avec Noah, et peut-être encore de l'escalade pour Léa l'après-midi.",
  ],
  general: [
    "Léa et Noah sont des jumeaux de 8 ans. Noah adore le foot, Léa adore l'escalade, et toute la famille aime la piscine et la cuisine asiatique.",
  ],
};

// The model reasons in French, so it may pass a French word as the topic
// argument instead of the English keys above (e.g. "foot" instead of
// "soccer") - map the common French terms onto the same fact list.
const TOPIC_ALIASES = {
  léa: "lea",
  foot: "soccer",
  football: "soccer",
  escalade: "climbing",
  grimpe: "climbing",
  piscine: "pool",
  "week-end": "weekend",
  général: "general",
  generale: "general",
};

function getFamilyFacts(topic) {
  const normalized = (topic || "").toLowerCase();
  for (const alias in TOPIC_ALIASES) {
    if (normalized.includes(alias)) return FAMILY_FACTS[TOPIC_ALIASES[alias]];
  }
  const key = Object.keys(FAMILY_FACTS).find((k) => normalized.includes(k));
  return FAMILY_FACTS[key] || FAMILY_FACTS.general;
}

// Plain <script> tag usage (browser) relies on the globals above; Node
// scripts pick them up via this export instead.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    FAMILY_SYSTEM_PROMPT,
    buildSystemPrompt,
    FAMILY_TOOL,
    WEB_SEARCH_TOOL,
    FAMILY_FACTS,
    getFamilyFacts,
  };
}
