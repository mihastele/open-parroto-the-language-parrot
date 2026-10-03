/**
 * Parroto — course definitions.
 *
 * All content here is ORIGINAL, written for this project. It follows the shape and
 * progression style of a Duolingo course (skills unlock in order, 5 levels each) but none
 * of it is copied from Duolingo's copyrighted course material.
 *
 * A course is data:
 *   { id, name, from, to, flag, tts, skills: [ { id, title, icon, items: [...] } ] }
 *
 * An "item" is the vocabulary/phrase unit everything else is generated from:
 *   { id, target, source, images?, note?, alternatives? }
 *
 * Exercise types are derived from items at runtime by exercisePlanFor(), so adding an item
 * automatically feeds every relevant exercise type.
 */

/** Spanish (for English speakers) — the flagship course. */
const SPANISH = {
  id: "es-en",
  name: "Spanish",
  from: "English",
  to: "Spanish",
  flag: "🇪🇸",
  tts: "es-ES",
  color: "#f5a623",
  skills: [
    {
      id: "es-basics-1",
      title: "Basics 1",
      icon: "chat",
      items: [
        { id: "es-hola", target: "hola", source: "hello", images: ["👋"], note: "A greeting for any time of day." },
        { id: "es-adios", target: "adiós", source: "goodbye", images: ["👋"] },
        { id: "es-gracias", target: "gracias", source: "thank you", images: ["🙏"] },
        { id: "es-si", target: "sí", source: "yes", images: ["✅"] },
        { id: "es-no", target: "no", source: "no", images: ["❌"] },
        { id: "es-agua", target: "agua", source: "water", images: ["💧"] },
        { id: "es-pan", target: "pan", source: "bread", images: ["🍞"] },
        { id: "es-nino", target: "el niño", source: "the boy", images: ["👦"], alternatives: ["niño"] },
        { id: "es-nina", target: "la niña", source: "the girl", images: ["👧"], alternatives: ["niña"] },
        { id: "es-mujer", target: "la mujer", source: "the woman", images: ["👩"], alternatives: ["mujer"] },
        { id: "es-hombre", target: "el hombre", source: "the man", images: ["👨"], alternatives: ["hombre"] },
        { id: "es-yo-soy", target: "yo soy", source: "I am" },
        { id: "es-tu-eres", target: "tú eres", source: "you are" },
      ],
    },
    {
      id: "es-basics-2",
      title: "Basics 2",
      icon: "chat",
      items: [
        { id: "es-por-favor", target: "por favor", source: "please" },
        { id: "es-perdon", target: "perdón", source: "excuse me", alternatives: ["perdon"] },
        { id: "es-buenos-dias", target: "buenos días", source: "good morning", alternatives: ["buenos dias"] },
        { id: "es-buenas-noches", target: "buenas noches", source: "good night" },
        { id: "es-como-estas", target: "¿cómo estás?", source: "how are you?", alternatives: ["como estas"] },
        { id: "es-muy-bien", target: "muy bien", source: "very well" },
        { id: "es-me-llamo", target: "me llamo", source: "my name is" },
        { id: "es-como-te-llamas", target: "¿cómo te llamas?", source: "what is your name?", alternatives: ["como te llamas"] },
        { id: "es-mucho-gusto", target: "mucho gusto", source: "nice to meet you" },
        { id: "es-hasta-luego", target: "hasta luego", source: "see you later" },
      ],
    },
    {
      id: "es-food",
      title: "Food",
      icon: "food",
      items: [
        { id: "es-manzana", target: "la manzana", source: "the apple", images: ["🍎"], alternatives: ["manzana"] },
        { id: "es-leche", target: "la leche", source: "the milk", images: ["🥛"], alternatives: ["leche"] },
        { id: "es-queso", target: "el queso", source: "the cheese", images: ["🧀"], alternatives: ["queso"] },
        { id: "es-huevo", target: "el huevo", source: "the egg", images: ["🥚"], alternatives: ["huevo"] },
        { id: "es-arroz", target: "el arroz", source: "the rice", images: ["🍚"], alternatives: ["arroz"] },
        { id: "es-cafe", target: "el café", source: "the coffee", images: ["☕"], alternatives: ["cafe"] },
        { id: "es-pollo", target: "el pollo", source: "the chicken", images: ["🍗"], alternatives: ["pollo"] },
        { id: "es-pescado", target: "el pescado", source: "the fish", images: ["🐟"], alternatives: ["pescado"] },
        { id: "es-quiero", target: "yo quiero", source: "I want" },
        { id: "es-como", target: "yo como", source: "I eat" },
        { id: "es-bebo", target: "yo bebo", source: "I drink" },
        { id: "es-la-cuenta", target: "la cuenta", source: "the bill", alternatives: ["cuenta"] },
      ],
    },
    {
      id: "es-family",
      title: "Family",
      icon: "people",
      items: [
        { id: "es-madre", target: "la madre", source: "the mother", images: ["👩"], alternatives: ["madre"] },
        { id: "es-padre", target: "el padre", source: "the father", images: ["👨"], alternatives: ["padre"] },
        { id: "es-hermano", target: "el hermano", source: "the brother", images: ["👦"], alternatives: ["hermano"] },
        { id: "es-hermana", target: "la hermana", source: "the sister", images: ["👧"], alternatives: ["hermana"] },
        { id: "es-hijo", target: "el hijo", source: "the son", alternatives: ["hijo"] },
        { id: "es-hija", target: "la hija", source: "the daughter", alternatives: ["hija"] },
        { id: "es-abuela", target: "la abuela", source: "the grandmother", images: ["👵"], alternatives: ["abuela"] },
        { id: "es-abuelo", target: "el abuelo", source: "the grandfather", images: ["👴"], alternatives: ["abuelo"] },
        { id: "es-familia", target: "la familia", source: "the family", images: ["👨‍👩‍👧"], alternatives: ["familia"] },
        { id: "es-mi-familia", target: "mi familia es grande", source: "my family is big" },
      ],
    },
    {
      id: "es-animals",
      title: "Animals",
      icon: "paw",
      items: [
        { id: "es-perro", target: "el perro", source: "the dog", images: ["🐕"], alternatives: ["perro"] },
        { id: "es-gato", target: "el gato", source: "the cat", images: ["🐈"], alternatives: ["gato"] },
        { id: "es-pajaro", target: "el pájaro", source: "the bird", images: ["🐦"], alternatives: ["pajaro"] },
        { id: "es-caballo", target: "el caballo", source: "the horse", images: ["🐎"], alternatives: ["caballo"] },
        { id: "es-vaca", target: "la vaca", source: "the cow", images: ["🐄"], alternatives: ["vaca"] },
        { id: "es-raton", target: "el ratón", source: "the mouse", images: ["🐁"], alternatives: ["raton"] },
        { id: "es-pez", target: "el pez", source: "the fish", images: ["🐠"], alternatives: ["pez"] },
        { id: "es-oso", target: "el oso", source: "the bear", images: ["🐻"], alternatives: ["oso"] },
        { id: "es-tengo-un-gato", target: "yo tengo un gato", source: "I have a cat" },
      ],
    },
    {
      id: "es-travel",
      title: "Travel",
      icon: "plane",
      items: [
        { id: "es-aeropuerto", target: "el aeropuerto", source: "the airport", images: ["✈️"], alternatives: ["aeropuerto"] },
        { id: "es-hotel", target: "el hotel", source: "the hotel", images: ["🏨"], alternatives: ["hotel"] },
        { id: "es-tren", target: "el tren", source: "the train", images: ["🚆"], alternatives: ["tren"] },
        { id: "es-billete", target: "el billete", source: "the ticket", images: ["🎫"], alternatives: ["billete"] },
        { id: "es-maleta", target: "la maleta", source: "the suitcase", images: ["🧳"], alternatives: ["maleta"] },
        { id: "es-mapa", target: "el mapa", source: "the map", images: ["🗺️"], alternatives: ["mapa"] },
        { id: "es-playa", target: "la playa", source: "the beach", images: ["🏖️"], alternatives: ["playa"] },
        { id: "es-ciudad", target: "la ciudad", source: "the city", images: ["🏙️"], alternatives: ["ciudad"] },
        { id: "es-donde-esta", target: "¿dónde está el hotel?", source: "where is the hotel?", alternatives: ["donde esta el hotel"] },
        { id: "es-necesito", target: "yo necesito un billete", source: "I need a ticket" },
      ],
    },
    {
      id: "es-phrases",
      title: "Phrases",
      icon: "quote",
      items: [
        { id: "es-no-entiendo", target: "yo no entiendo", source: "I do not understand" },
        { id: "es-habla-ingles", target: "¿tú hablas inglés?", source: "do you speak English?", alternatives: ["tu hablas ingles"] },
        { id: "es-repite", target: "¿puedes repetir?", source: "can you repeat?", alternatives: ["puedes repetir"] },
        { id: "es-despacio", target: "más despacio, por favor", source: "more slowly, please", alternatives: ["mas despacio por favor"] },
        { id: "es-donde-bano", target: "¿dónde está el baño?", source: "where is the bathroom?", alternatives: ["donde esta el bano"] },
        { id: "es-cuanto-cuesta", target: "¿cuánto cuesta?", source: "how much does it cost?", alternatives: ["cuanto cuesta"] },
        { id: "es-ayuda", target: "necesito ayuda", source: "I need help" },
        { id: "es-me-gusta", target: "me gusta esto", source: "I like this" },
      ],
    },
  ],
};

/** French — a second full course, proving the engine is language-agnostic. */
const FRENCH = {
  id: "fr-en",
  name: "French",
  from: "English",
  to: "French",
  flag: "🇫🇷",
  tts: "fr-FR",
  color: "#4a90d9",
  skills: [
    {
      id: "fr-basics-1",
      title: "Basics 1",
      icon: "chat",
      items: [
        { id: "fr-bonjour", target: "bonjour", source: "hello", images: ["👋"] },
        { id: "fr-au-revoir", target: "au revoir", source: "goodbye", images: ["👋"] },
        { id: "fr-merci", target: "merci", source: "thank you", images: ["🙏"] },
        { id: "fr-oui", target: "oui", source: "yes", images: ["✅"] },
        { id: "fr-non", target: "non", source: "no", images: ["❌"] },
        { id: "fr-eau", target: "l'eau", source: "the water", images: ["💧"], alternatives: ["eau"] },
        { id: "fr-pain", target: "le pain", source: "the bread", images: ["🍞"], alternatives: ["pain"] },
        { id: "fr-garcon", target: "le garçon", source: "the boy", images: ["👦"], alternatives: ["garcon"] },
        { id: "fr-fille", target: "la fille", source: "the girl", images: ["👧"] },
        { id: "fr-femme", target: "la femme", source: "the woman", images: ["👩"] },
        { id: "fr-homme", target: "l'homme", source: "the man", images: ["👨"], alternatives: ["homme"] },
        { id: "fr-je-suis", target: "je suis", source: "I am" },
      ],
    },
    {
      id: "fr-food",
      title: "Food",
      icon: "food",
      items: [
        { id: "fr-pomme", target: "la pomme", source: "the apple", images: ["🍎"], alternatives: ["pomme"] },
        { id: "fr-fromage", target: "le fromage", source: "the cheese", images: ["🧀"], alternatives: ["fromage"] },
        { id: "fr-lait", target: "le lait", source: "the milk", images: ["🥛"], alternatives: ["lait"] },
        { id: "fr-cafe", target: "le café", source: "the coffee", images: ["☕"], alternatives: ["cafe"] },
        { id: "fr-oeuf", target: "l'œuf", source: "the egg", images: ["🥚"], alternatives: ["oeuf"] },
        { id: "fr-je-veux", target: "je veux", source: "I want" },
        { id: "fr-je-mange", target: "je mange", source: "I eat" },
        { id: "fr-laddition", target: "l'addition", source: "the bill", alternatives: ["addition"] },
      ],
    },
    {
      id: "fr-phrases",
      title: "Phrases",
      icon: "quote",
      items: [
        { id: "fr-comment", target: "comment allez-vous ?", source: "how are you?", alternatives: ["comment allez-vous"] },
        { id: "fr-je-mapelle", target: "je m'appelle", source: "my name is", alternatives: ["je mappelle"] },
        { id: "fr-je-ne-comprends", target: "je ne comprends pas", source: "I do not understand" },
        { id: "fr-parlez-anglais", target: "parlez-vous anglais ?", source: "do you speak English?", alternatives: ["parlez-vous anglais"] },
        { id: "fr-ou-est", target: "où est la gare ?", source: "where is the station?", alternatives: ["ou est la gare"] },
        { id: "fr-combien", target: "combien ça coûte ?", source: "how much does it cost?", alternatives: ["combien ca coute"] },
      ],
    },
  ],
};

/** German — a third course, to prove content scales without engine changes. */
const GERMAN = {
  id: "de-en",
  name: "German",
  from: "English",
  to: "German",
  flag: "🇩🇪",
  tts: "de-DE",
  color: "#d9534f",
  skills: [
    {
      id: "de-basics-1",
      title: "Basics 1",
      icon: "chat",
      items: [
        { id: "de-hallo", target: "hallo", source: "hello", images: ["👋"] },
        { id: "de-tschuess", target: "tschüss", source: "bye", images: ["👋"], alternatives: ["tschuess"] },
        { id: "de-danke", target: "danke", source: "thank you", images: ["🙏"] },
        { id: "de-ja", target: "ja", source: "yes", images: ["✅"] },
        { id: "de-nein", target: "nein", source: "no", images: ["❌"] },
        { id: "de-wasser", target: "das Wasser", source: "the water", images: ["💧"], alternatives: ["wasser"] },
        { id: "de-brot", target: "das Brot", source: "the bread", images: ["🍞"], alternatives: ["brot"] },
        { id: "de-junge", target: "der Junge", source: "the boy", images: ["👦"], alternatives: ["junge"] },
        { id: "de-maedchen", target: "das Mädchen", source: "the girl", images: ["👧"], alternatives: ["maedchen"] },
        { id: "de-frau", target: "die Frau", source: "the woman", images: ["👩"], alternatives: ["frau"] },
        { id: "de-mann", target: "der Mann", source: "the man", images: ["👨"], alternatives: ["mann"] },
        { id: "de-ich-bin", target: "ich bin", source: "I am" },
      ],
    },
    {
      id: "de-food",
      title: "Food",
      icon: "food",
      items: [
        { id: "de-apfel", target: "der Apfel", source: "the apple", images: ["🍎"], alternatives: ["apfel"] },
        { id: "de-kaese", target: "der Käse", source: "the cheese", images: ["🧀"], alternatives: ["kaese"] },
        { id: "de-milch", target: "die Milch", source: "the milk", images: ["🥛"], alternatives: ["milch"] },
        { id: "de-kaffee", target: "der Kaffee", source: "the coffee", images: ["☕"], alternatives: ["kaffee"] },
        { id: "de-ei", target: "das Ei", source: "the egg", images: ["🥚"], alternatives: ["ei"] },
        { id: "de-ich-will", target: "ich will", source: "I want" },
        { id: "de-ich-esse", target: "ich esse", source: "I eat" },
      ],
    },
    {
      id: "de-phrases",
      title: "Phrases",
      icon: "quote",
      items: [
        { id: "de-wie-gehts", target: "wie geht's?", source: "how are you?", alternatives: ["wie gehts"] },
        { id: "de-ich-heisse", target: "ich heiße", source: "my name is", alternatives: ["ich heisse"] },
        { id: "de-verstehe-nicht", target: "ich verstehe nicht", source: "I do not understand" },
        { id: "de-sprechen-englisch", target: "sprechen Sie Englisch?", source: "do you speak English?", alternatives: ["sprechen sie englisch"] },
        { id: "de-wo-ist", target: "wo ist der Bahnhof?", source: "where is the station?", alternatives: ["wo ist der bahnhof"] },
      ],
    },
  ],
};

/**
 * An Italian taster, used to demonstrate that a course can be shorter than the flagship
 * one and still drive every exercise type.
 */
const ITALIAN = {
  id: "it-en",
  name: "Italian",
  from: "English",
  to: "Italian",
  flag: "🇮🇹",
  tts: "it-IT",
  color: "#3f9e5a",
  skills: [
    {
      id: "it-basics-1",
      title: "Basics 1",
      icon: "chat",
      items: [
        { id: "it-ciao", target: "ciao", source: "hello", images: ["👋"] },
        { id: "it-grazie", target: "grazie", source: "thank you", images: ["🙏"] },
        { id: "it-si", target: "sì", source: "yes", images: ["✅"] },
        { id: "it-no", target: "no", source: "no", images: ["❌"] },
        { id: "it-acqua", target: "l'acqua", source: "the water", images: ["💧"], alternatives: ["acqua"] },
        { id: "it-ragazzo", target: "il ragazzo", source: "the boy", images: ["👦"], alternatives: ["ragazzo"] },
        { id: "it-ragazza", target: "la ragazza", source: "the girl", images: ["👧"], alternatives: ["ragazza"] },
        { id: "it-io-sono", target: "io sono", source: "I am" },
      ],
    },
    {
      id: "it-basics-2",
      title: "Basics 2",
      icon: "chat",
      items: [
        { id: "it-buongiorno", target: "buongiorno", source: "good morning", images: ["🌅"] },
        { id: "it-buonasera", target: "buonasera", source: "good evening", images: ["🌆"] },
        { id: "it-arrivederci", target: "arrivederci", source: "goodbye", images: ["👋"] },
        { id: "it-per-favore", target: "per favore", source: "please" },
        { id: "it-scusi", target: "scusi", source: "excuse me" },
        { id: "it-come-stai", target: "come stai?", source: "how are you?", alternatives: ["come stai"] },
        { id: "it-mi-chiamo", target: "mi chiamo", source: "my name is" },
        { id: "it-piacere", target: "piacere", source: "nice to meet you" },
        { id: "it-non-capisco", target: "non capisco", source: "I do not understand" },
        { id: "it-a-domani", target: "a domani", source: "see you tomorrow" },
      ],
    },
    {
      id: "it-food",
      title: "Food",
      icon: "food",
      items: [
        { id: "it-mela", target: "la mela", source: "the apple", images: ["🍎"], alternatives: ["mela"] },
        { id: "it-formaggio", target: "il formaggio", source: "the cheese", images: ["🧀"], alternatives: ["formaggio"] },
        { id: "it-latte", target: "il latte", source: "the milk", images: ["🥛"], alternatives: ["latte"] },
        { id: "it-caffe", target: "il caffè", source: "the coffee", images: ["☕"], alternatives: ["caffe"] },
        { id: "it-pizza", target: "la pizza", source: "the pizza", images: ["🍕"], alternatives: ["pizza"] },
        { id: "it-pane", target: "il pane", source: "the bread", images: ["🍞"], alternatives: ["pane"] },
        { id: "it-acqua-frizzante", target: "l'acqua frizzante", source: "the sparkling water", alternatives: ["acqua frizzante"] },
        { id: "it-voglio", target: "io voglio", source: "I want" },
        { id: "it-mangio", target: "io mangio", source: "I eat" },
        { id: "it-bevo", target: "io bevo", source: "I drink" },
      ],
    },
    {
      id: "it-travel",
      title: "Travel",
      icon: "plane",
      items: [
        { id: "it-aeroporto", target: "l'aeroporto", source: "the airport", images: ["✈️"], alternatives: ["aeroporto"] },
        { id: "it-treno", target: "il treno", source: "the train", images: ["🚆"], alternatives: ["treno"] },
        { id: "it-hotel", target: "l'hotel", source: "the hotel", images: ["🏨"], alternatives: ["hotel"] },
        { id: "it-biglietto", target: "il biglietto", source: "the ticket", images: ["🎫"], alternatives: ["biglietto"] },
        { id: "it-valigia", target: "la valigia", source: "the suitcase", images: ["🧳"], alternatives: ["valigia"] },
        { id: "it-stazione", target: "la stazione", source: "the station", images: ["🚉"], alternatives: ["stazione"] },
        { id: "it-spiaggia", target: "la spiaggia", source: "the beach", images: ["🏖️"], alternatives: ["spiaggia"] },
        { id: "it-dove-albergo", target: "dov'è l'hotel?", source: "where is the hotel?", alternatives: ["dove e l'hotel"] },
        { id: "it-bisogno", target: "ho bisogno di aiuto", source: "I need help" },
      ],
    },
  ],
};

/**
 * A "story" — a short dialogue with comprehension questions, the Duolingo Stories format.
 * Stories are attached to a course and unlocked once a given number of skills are complete.
 */
const STORIES = {
  "es-en": [
    {
      id: "es-story-cafe",
      title: "En el café",
      titleEn: "At the café",
      icon: "☕",
      requiresSkills: 2,
      lines: [
        { speaker: "Camarero", text: "¡Buenos días! ¿Qué desea?", en: "Good morning! What would you like?" },
        { speaker: "Ana", text: "Hola, quiero un café, por favor.", en: "Hello, I want a coffee, please." },
        { speaker: "Camarero", text: "¿Con leche?", en: "With milk?" },
        { speaker: "Ana", text: "Sí, con leche. Gracias.", en: "Yes, with milk. Thank you." },
        { speaker: "Camarero", text: "Son dos euros.", en: "That's two euros." },
        { speaker: "Ana", text: "Aquí tiene. ¡Hasta luego!", en: "Here you are. See you later!" },
      ],
      questions: [
        { id: "q1", q: "What does Ana order?", choices: ["Tea", "Coffee with milk", "Water", "Bread"], answer: "Coffee with milk" },
        { id: "q2", q: "How much does it cost?", choices: ["One euro", "Two euros", "Three euros", "Free"], answer: "Two euros" },
        { id: "q3", q: "How does Ana say goodbye?", choices: ["Buenos días", "Hasta luego", "Por favor", "Perdón"], answer: "Hasta luego" },
      ],
    },
    {
      id: "es-story-familia",
      title: "La familia de Pablo",
      titleEn: "Pablo's family",
      icon: "👨‍👩‍👧",
      requiresSkills: 4,
      lines: [
        { speaker: "Pablo", text: "Mi familia es grande. Tengo dos hermanos.", en: "My family is big. I have two brothers." },
        { speaker: "Pablo", text: "Mi madre es profesora y mi padre es médico.", en: "My mother is a teacher and my father is a doctor." },
        { speaker: "Sara", text: "¿Y tu abuela vive contigo?", en: "And does your grandmother live with you?" },
        { speaker: "Pablo", text: "Sí, ella vive con nosotros.", en: "Yes, she lives with us." },
      ],
      questions: [
        { id: "q1", q: "How many brothers does Pablo have?", choices: ["One", "Two", "Three", "None"], answer: "Two" },
        { id: "q2", q: "What does Pablo's father do?", choices: ["Teacher", "Doctor", "Chef", "Driver"], answer: "Doctor" },
        { id: "q3", q: "Who lives with the family?", choices: ["The uncle", "The grandmother", "The cousin", "Nobody"], answer: "The grandmother" },
      ],
    },
  ],
  "fr-en": [
    {
      id: "fr-story-boulangerie",
      title: "À la boulangerie",
      titleEn: "At the bakery",
      icon: "🥐",
      requiresSkills: 2,
      lines: [
        { speaker: "Client", text: "Bonjour ! Je voudrais du pain, s'il vous plaît.", en: "Hello! I would like some bread, please." },
        { speaker: "Boulangère", text: "Bien sûr. Et avec ça ?", en: "Of course. Anything else?" },
        { speaker: "Client", text: "Un café aussi. Merci !", en: "A coffee too. Thanks!" },
        { speaker: "Boulangère", text: "Ça fait trois euros.", en: "That comes to three euros." },
      ],
      questions: [
        { id: "q1", q: "What does the customer buy?", choices: ["Bread and coffee", "Cheese", "Water", "An egg"], answer: "Bread and coffee" },
        { id: "q2", q: "How much is it?", choices: ["Two euros", "Three euros", "Four euros", "One euro"], answer: "Three euros" },
      ],
    },
  ],
};

export const COURSES = [SPANISH, FRENCH, GERMAN, ITALIAN];

export function getCourse(id) {
  return COURSES.find((c) => c.id === id) ?? null;
}

export function getSkill(courseId, skillId) {
  const course = getCourse(courseId);
  if (!course) return null;
  return course.skills.find((s) => s.id === skillId) ?? null;
}

export function storiesFor(courseId) {
  return STORIES[courseId] ?? [];
}

/** Flattens every item in a course, tagged with its skill. */
export function allItems(course) {
  const out = [];
  for (const skill of course.skills) {
    for (const item of skill.items) out.push({ ...item, skillId: skill.id });
  }
  return out;
}

/** Course metadata for the picker screen. */
export function courseSummaries() {
  return COURSES.map((c) => ({
    id: c.id,
    name: c.name,
    from: c.from,
    to: c.to,
    flag: c.flag,
    color: c.color,
    skillCount: c.skills.length,
    itemCount: allItems(c).length,
    storyCount: storiesFor(c.id).length,
  }));
}
