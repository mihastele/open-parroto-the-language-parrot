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
 *
 * The six courses below are built in. Drop-in courses live in `./courses/` as
 * `course-<id>.mjs` files (written by `npm run import:course`) and are picked up
 * automatically — see loadExtraCourses.
 */

import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Directory auto-scanned for drop-in course files. Missing means no extra courses. */
export const EXTRA_COURSES_DIR = join(dirname(fileURLToPath(import.meta.url)), "courses");

/**
 * Loads drop-in course files from a directory. Each `course-*.mjs` file must export
 * `COURSE` ({ id, name, ..., skills: [...] }) and may export `STORIES` ([...]).
 * Files load in filename order, so the resulting course order is deterministic.
 * `existingIds` guards against a drop-in shadowing a built-in course.
 */
export async function loadExtraCourses(dir = EXTRA_COURSES_DIR, existingIds = []) {
  const courses = [];
  const stories = {};
  let files = [];
  try {
    files = (await readdir(dir))
      .filter((f) => f.startsWith("course-") && f.endsWith(".mjs"))
      .sort();
  } catch (err) {
    if (err?.code !== "ENOENT") throw err;
    return { courses, stories };
  }
  const seen = new Set(existingIds);
  for (const file of files) {
    const mod = await import(pathToFileURL(join(dir, file)).href);
    const course = mod.COURSE;
    if (!course || typeof course.id !== "string" || !Array.isArray(course.skills)) {
      throw new Error(`${file}: must export COURSE { id, name, ..., skills: [...] }`);
    }
    if (seen.has(course.id)) {
      throw new Error(`${file}: duplicate course id "${course.id}"`);
    }
    seen.add(course.id);
    courses.push(course);
    if (mod.STORIES !== undefined) {
      if (!Array.isArray(mod.STORIES)) throw new Error(`${file}: STORIES must be an array`);
      stories[course.id] = mod.STORIES;
    }
  }
  return { courses, stories };
}

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
        { id: "fr-comment", target: "comment allez-vous ?", source: "how are you?" },
        { id: "fr-je-mapelle", target: "je m'appelle", source: "my name is", alternatives: ["je mappelle"] },
        { id: "fr-je-ne-comprends", target: "je ne comprends pas", source: "I do not understand" },
        { id: "fr-parlez-anglais", target: "parlez-vous anglais ?", source: "do you speak English?" },
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
        { id: "de-sprechen-englisch", target: "sprechen Sie Englisch?", source: "do you speak English?" },
        { id: "de-wo-ist", target: "wo ist der Bahnhof?", source: "where is the station?" },
      ],
    },
  ],
};

/**
 * Norwegian (Bokmål) — for English speakers.
 *
 * Norwegian and Swedish are close enough that a learner can often read the other, so the two
 * courses deliberately share a shape and reuse the same cognate patterns. Content is original,
 * following the same progression as the other courses.
 */
const NORWEGIAN = {
  id: "nb-en",
  name: "Norwegian",
  from: "English",
  to: "Norwegian",
  flag: "🇳🇴",
  tts: "nb-NO",
  color: "#ba0c2f",
  skills: [
    {
      id: "nb-basics-1",
      title: "Basics 1",
      icon: "chat",
      items: [
        { id: "nb-hei", target: "hei", source: "hello", images: ["👋"] },
        { id: "nb-ha-det", target: "ha det", source: "goodbye", images: ["👋"] },
        { id: "nb-takk", target: "takk", source: "thank you", images: ["🙏"] },
        { id: "nb-ja", target: "ja", source: "yes", images: ["✅"] },
        { id: "nb-nei", target: "nei", source: "no", images: ["❌"] },
        { id: "nb-vann", target: "vann", source: "water", images: ["💧"] },
        { id: "nb-brod", target: "brød", source: "bread", images: ["🍞"], alternatives: ["brod"] },
        { id: "nb-gutt", target: "gutten", source: "the boy", images: ["👦"], alternatives: ["gutt"] },
        { id: "nb-jente", target: "jenta", source: "the girl", images: ["👧"], alternatives: ["jente"] },
        { id: "nb-kvinne", target: "kvinnen", source: "the woman", images: ["👩"], alternatives: ["kvinne"] },
        { id: "nb-mann", target: "mannen", source: "the man", images: ["👨"], alternatives: ["mann"] },
        { id: "nb-eg-er", target: "jeg er", source: "I am", alternatives: ["eg er"] },
      ],
    },
    {
      id: "nb-basics-2",
      title: "Basics 2",
      icon: "chat",
      items: [
        { id: "nb-god-morgen", target: "god morgen", source: "good morning", images: ["🌅"] },
        { id: "nb-god-kveld", target: "god kveld", source: "good evening", images: ["🌆"] },
        { id: "nb-vaer-sa-snill", target: "vær så snill", source: "please", images: ["🙏"], alternatives: ["vaer sa snill"] },
        { id: "nb-unnskyld", target: "unnskyld", source: "excuse me", images: ["🙇"] },
        { id: "nb-hvordan-gar-det", target: "hvordan går det?", source: "how are you?", images: ["🤝"], alternatives: ["hvordan gar det"] },
        { id: "nb-bare-bra", target: "bare bra", source: "just fine", images: ["👍"] },
        { id: "nb-jeg-heter", target: "jeg heter", source: "my name is", images: ["🪪"] },
        { id: "nb-hva-heter-du", target: "hva heter du?", source: "what is your name?", images: ["❓"] },
        { id: "nb-hyggelig", target: "hyggelig", source: "nice to meet you", images: ["😊"] },
        { id: "nb-sees-senere", target: "vi sees senere", source: "see you later", images: ["👋"] },
      ],
    },
    {
      id: "nb-food",
      title: "Food",
      icon: "food",
      items: [
        { id: "nb-eple", target: "eplet", source: "the apple", images: ["🍎"], alternatives: ["eple"] },
        { id: "nb-melk", target: "melken", source: "the milk", images: ["🥛"], alternatives: ["melk"] },
        { id: "nb-ost", target: "osten", source: "the cheese", images: ["🧀"], alternatives: ["ost"] },
        { id: "nb-egg", target: "egget", source: "the egg", images: ["🥚"], alternatives: ["egg"] },
        { id: "nb-ris", target: "risen", source: "the rice", images: ["🍚"], alternatives: ["ris"] },
        { id: "nb-kaffe", target: "kaffen", source: "the coffee", images: ["☕"], alternatives: ["kaffe"] },
        { id: "nb-fisk", target: "fisken", source: "the fish", images: ["🐟"], alternatives: ["fisk"] },
        { id: "nb-brodmat", target: "brødmat", source: "the sandwich", images: ["🥪"] },
        { id: "nb-jeg-vil", target: "jeg vil", source: "I want" },
        { id: "nb-jeg-spiser", target: "jeg spiser", source: "I eat" },
        { id: "nb-jeg-drikker", target: "jeg drikker", source: "I drink" },
        { id: "nb-regningen", target: "regningen", source: "the bill", alternatives: ["regning"] },
      ],
    },
    {
      id: "nb-family",
      title: "Family",
      icon: "people",
      items: [
        { id: "nb-mor", target: "moren", source: "the mother", images: ["👩"], alternatives: ["mor", "mora"] },
        { id: "nb-far", target: "faren", source: "the father", images: ["👨"], alternatives: ["far"] },
        { id: "nb-bror", target: "broren", source: "the brother", images: ["👦"], alternatives: ["bror"] },
        { id: "nb-soster", target: "søsteren", source: "the sister", images: ["👧"], alternatives: ["soster", "søster"] },
        { id: "nb-sonn", target: "sønnen", source: "the son", alternatives: ["sonn", "sønn"] },
        { id: "nb-datter", target: "datteren", source: "the daughter", alternatives: ["datter"] },
        { id: "nb-bestemor", target: "bestemoren", source: "the grandmother", images: ["👵"], alternatives: ["bestemor"] },
        { id: "nb-bestefar", target: "bestefaren", source: "the grandfather", images: ["👴"], alternatives: ["bestefar"] },
        { id: "nb-familie", target: "familien", source: "the family", images: ["👨‍👩‍👧"], alternatives: ["familie"] },
        { id: "nb-familien-stor", target: "familien min er stor", source: "my family is big" },
      ],
    },
    {
      id: "nb-animals",
      title: "Animals",
      icon: "paw",
      items: [
        { id: "nb-hund", target: "hunden", source: "the dog", images: ["🐕"], alternatives: ["hund"] },
        { id: "nb-katt", target: "katten", source: "the cat", images: ["🐈"], alternatives: ["katt"] },
        { id: "nb-fugl", target: "fuglen", source: "the bird", images: ["🐦"], alternatives: ["fugl"] },
        { id: "nb-hest", target: "hesten", source: "the horse", images: ["🐎"], alternatives: ["hest"] },
        { id: "nb-ku", target: "kua", source: "the cow", images: ["🐄"], alternatives: ["ku"] },
        { id: "nb-mus", target: "musen", source: "the mouse", images: ["🐁"], alternatives: ["mus"] },
        { id: "nb-bjorn", target: "bjørnen", source: "the bear", images: ["🐻"], alternatives: ["bjorn", "bjørn"] },
        { id: "nb-elg", target: "elgen", source: "the moose", images: ["🫎"], alternatives: ["elg"] },
        { id: "nb-jeg-har-katt", target: "jeg har en katt", source: "I have a cat" },
      ],
    },
    {
      id: "nb-travel",
      title: "Travel",
      icon: "plane",
      items: [
        { id: "nb-flyplass", target: "flyplassen", source: "the airport", images: ["✈️"], alternatives: ["flyplass"] },
        { id: "nb-hotell", target: "hotellet", source: "the hotel", images: ["🏨"], alternatives: ["hotell"] },
        { id: "nb-tog", target: "toget", source: "the train", images: ["🚆"], alternatives: ["tog"] },
        { id: "nb-billett", target: "billetten", source: "the ticket", images: ["🎫"], alternatives: ["billett"] },
        { id: "nb-koffert", target: "kofferten", source: "the suitcase", images: ["🧳"], alternatives: ["koffert"] },
        { id: "nb-kart", target: "kartet", source: "the map", images: ["🗺️"], alternatives: ["kart"] },
        { id: "nb-strand", target: "stranden", source: "the beach", images: ["🏖️"], alternatives: ["strand"] },
        { id: "nb-by", target: "byen", source: "the city", images: ["🏙️"], alternatives: ["by"] },
        { id: "nb-hvor-er-hotell", target: "hvor er hotellet?", source: "where is the hotel?" },
        { id: "nb-trenger-billett", target: "jeg trenger en billett", source: "I need a ticket" },
      ],
    },
    {
      id: "nb-phrases",
      title: "Phrases",
      icon: "quote",
      items: [
        { id: "nb-forstar-ikke", target: "jeg forstår ikke", source: "I do not understand", alternatives: ["jeg forstar ikke"] },
        { id: "nb-snakker-engelsk", target: "snakker du engelsk?", source: "do you speak English?" },
        { id: "nb-kan-gjenta", target: "kan du gjenta?", source: "can you repeat?" },
        { id: "nb-saktere", target: "saktere, takk", source: "more slowly, please", alternatives: ["saktere takk"] },
        { id: "nb-hvor-er-badet", target: "hvor er badet?", source: "where is the bathroom?" },
        { id: "nb-hvor-mye", target: "hvor mye koster det?", source: "how much does it cost?" },
        { id: "nb-trenger-hjelp", target: "jeg trenger hjelp", source: "I need help" },
        { id: "nb-liker-dette", target: "jeg liker dette", source: "I like this" },
      ],
    },
  ],
};

/** Swedish — the sibling course to Norwegian, with the same structure and progression. */
const SWEDISH = {
  id: "sv-en",
  name: "Swedish",
  from: "English",
  to: "Swedish",
  flag: "🇸🇪",
  tts: "sv-SE",
  color: "#006aa7",
  skills: [
    {
      id: "sv-basics-1",
      title: "Basics 1",
      icon: "chat",
      items: [
        { id: "sv-hej", target: "hej", source: "hello", images: ["👋"] },
        { id: "sv-hejda", target: "hej då", source: "goodbye", images: ["👋"], alternatives: ["hej da"] },
        { id: "sv-tack", target: "tack", source: "thank you", images: ["🙏"] },
        { id: "sv-ja", target: "ja", source: "yes", images: ["✅"] },
        { id: "sv-nej", target: "nej", source: "no", images: ["❌"] },
        { id: "sv-vatten", target: "vatten", source: "water", images: ["💧"] },
        { id: "sv-brod", target: "bröd", source: "bread", images: ["🍞"], alternatives: ["brod"] },
        { id: "sv-pojke", target: "pojken", source: "the boy", images: ["👦"], alternatives: ["pojke"] },
        { id: "sv-flicka", target: "flickan", source: "the girl", images: ["👧"], alternatives: ["flicka"] },
        { id: "sv-kvinna", target: "kvinnan", source: "the woman", images: ["👩"], alternatives: ["kvinna"] },
        { id: "sv-man", target: "mannen", source: "the man", images: ["👨"], alternatives: ["man"] },
        { id: "sv-jag-ar", target: "jag är", source: "I am", alternatives: ["jag ar"] },
      ],
    },
    {
      id: "sv-basics-2",
      title: "Basics 2",
      icon: "chat",
      items: [
        { id: "sv-god-morgon", target: "god morgon", source: "good morning", images: ["🌅"] },
        { id: "sv-god-kvall", target: "god kväll", source: "good evening", images: ["🌆"], alternatives: ["god kvall"] },
        { id: "sv-snalla", target: "snälla", source: "please", images: ["🙏"], alternatives: ["snalla"] },
        { id: "sv-ursakta", target: "ursäkta", source: "excuse me", images: ["🙇"], alternatives: ["ursakta"] },
        { id: "sv-hur-mar-du", target: "hur mår du?", source: "how are you?", images: ["🤝"], alternatives: ["hur mar du"] },
        { id: "sv-bara-bra", target: "bara bra", source: "just fine", images: ["👍"] },
        { id: "sv-jag-heter", target: "jag heter", source: "my name is", images: ["🪪"] },
        { id: "sv-vad-heter-du", target: "vad heter du?", source: "what is your name?", images: ["❓"] },
        { id: "sv-trevligt", target: "trevligt", source: "nice to meet you", images: ["😊"] },
        { id: "sv-ses-senare", target: "vi ses senare", source: "see you later", images: ["👋"] },
      ],
    },
    {
      id: "sv-food",
      title: "Food",
      icon: "food",
      items: [
        { id: "sv-apple", target: "äpplet", source: "the apple", images: ["🍎"], alternatives: ["applet", "äpple"] },
        { id: "sv-mjolk", target: "mjölken", source: "the milk", images: ["🥛"], alternatives: ["mjolken", "mjölk"] },
        { id: "sv-ost", target: "osten", source: "the cheese", images: ["🧀"], alternatives: ["ost"] },
        { id: "sv-agg", target: "ägget", source: "the egg", images: ["🥚"], alternatives: ["agget", "ägg"] },
        { id: "sv-ris", target: "riset", source: "the rice", images: ["🍚"], alternatives: ["ris"] },
        { id: "sv-kaffe", target: "kaffet", source: "the coffee", images: ["☕"], alternatives: ["kaffe"] },
        { id: "sv-fisk", target: "fisken", source: "the fish", images: ["🐟"], alternatives: ["fisk"] },
        { id: "sv-smorgas", target: "smörgåsen", source: "the sandwich", images: ["🥪"], alternatives: ["smorgasen", "smörgås"] },
        { id: "sv-jag-vill", target: "jag vill", source: "I want" },
        { id: "sv-jag-ater", target: "jag äter", source: "I eat", alternatives: ["jag ater"] },
        { id: "sv-jag-dricker", target: "jag dricker", source: "I drink" },
        { id: "sv-rakningen", target: "räkningen", source: "the bill", alternatives: ["rakningen", "räkning"] },
      ],
    },
    {
      id: "sv-family",
      title: "Family",
      icon: "people",
      items: [
        { id: "sv-mor", target: "mamman", source: "the mother", images: ["👩"], alternatives: ["mor", "mamma"] },
        { id: "sv-far", target: "pappan", source: "the father", images: ["👨"], alternatives: ["far", "pappa"] },
        { id: "sv-bror", target: "brodern", source: "the brother", images: ["👦"], alternatives: ["bror"] },
        { id: "sv-syster", target: "systern", source: "the sister", images: ["👧"], alternatives: ["syster"] },
        { id: "sv-son", target: "sonen", source: "the son", alternatives: ["son"] },
        { id: "sv-dotter", target: "dottern", source: "the daughter", alternatives: ["dotter"] },
        { id: "sv-mormor", target: "mormodern", source: "the grandmother", images: ["👵"], alternatives: ["mormor"] },
        { id: "sv-morfar", target: "morfadern", source: "the grandfather", images: ["👴"], alternatives: ["morfar"] },
        { id: "sv-familj", target: "familjen", source: "the family", images: ["👨‍👩‍👧"], alternatives: ["familj"] },
        { id: "sv-familjen-stor", target: "min familj är stor", source: "my family is big", alternatives: ["min familj ar stor"] },
      ],
    },
    {
      id: "sv-animals",
      title: "Animals",
      icon: "paw",
      items: [
        { id: "sv-hund", target: "hunden", source: "the dog", images: ["🐕"], alternatives: ["hund"] },
        { id: "sv-katt", target: "katten", source: "the cat", images: ["🐈"], alternatives: ["katt"] },
        { id: "sv-fagel", target: "fågeln", source: "the bird", images: ["🐦"], alternatives: ["fageln", "fågel"] },
        { id: "sv-hast", target: "hästen", source: "the horse", images: ["🐎"], alternatives: ["hasten", "häst"] },
        { id: "sv-ko", target: "kon", source: "the cow", images: ["🐄"], alternatives: ["ko"] },
        { id: "sv-mus", target: "musen", source: "the mouse", images: ["🐁"], alternatives: ["mus"] },
        { id: "sv-bjorn", target: "björnen", source: "the bear", images: ["🐻"], alternatives: ["bjornen", "björn"] },
        { id: "sv-alg", target: "älgen", source: "the moose", images: ["🫎"], alternatives: ["algen", "älg"] },
        { id: "sv-jag-har-katt", target: "jag har en katt", source: "I have a cat" },
      ],
    },
    {
      id: "sv-travel",
      title: "Travel",
      icon: "plane",
      items: [
        { id: "sv-flygplats", target: "flygplatsen", source: "the airport", images: ["✈️"], alternatives: ["flygplats"] },
        { id: "sv-hotell", target: "hotellet", source: "the hotel", images: ["🏨"], alternatives: ["hotell"] },
        { id: "sv-tag", target: "tåget", source: "the train", images: ["🚆"], alternatives: ["taget", "tåg"] },
        { id: "sv-biljett", target: "biljetten", source: "the ticket", images: ["🎫"], alternatives: ["biljett"] },
        { id: "sv-vaska", target: "väskan", source: "the suitcase", images: ["🧳"], alternatives: ["vaskan", "väska"] },
        { id: "sv-karta", target: "kartan", source: "the map", images: ["🗺️"], alternatives: ["karta"] },
        { id: "sv-strand", target: "stranden", source: "the beach", images: ["🏖️"], alternatives: ["strand"] },
        { id: "sv-stad", target: "staden", source: "the city", images: ["🏙️"], alternatives: ["stad"] },
        { id: "sv-var-ar-hotell", target: "var är hotellet?", source: "where is the hotel?", alternatives: ["var ar hotellet"] },
        { id: "sv-behover-biljett", target: "jag behöver en biljett", source: "I need a ticket", alternatives: ["jag behover en biljett"] },
      ],
    },
    {
      id: "sv-phrases",
      title: "Phrases",
      icon: "quote",
      items: [
        { id: "sv-forstar-inte", target: "jag förstår inte", source: "I do not understand", alternatives: ["jag forstar inte"] },
        { id: "sv-pratar-engelska", target: "pratar du engelska?", source: "do you speak English?" },
        { id: "sv-kan-upprepa", target: "kan du upprepa?", source: "can you repeat?" },
        { id: "sv-langsammare", target: "långsammare, tack", source: "more slowly, please", alternatives: ["langsammare tack"] },
        { id: "sv-var-ar-toaletten", target: "var är toaletten?", source: "where is the bathroom?", alternatives: ["var ar toaletten"] },
        { id: "sv-hur-mycket", target: "hur mycket kostar det?", source: "how much does it cost?" },
        { id: "sv-behover-hjalp", target: "jag behöver hjälp", source: "I need help", alternatives: ["jag behover hjalp"] },
        { id: "sv-gillar-detta", target: "jag gillar detta", source: "I like this" },
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
        { id: "it-come-stai", target: "come stai?", source: "how are you?" },
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
  "nb-en": [
    {
      id: "nb-story-kafeen",
      title: "På kafeen",
      titleEn: "At the café",
      icon: "☕",
      requiresSkills: 2,
      lines: [
        { speaker: "Servitør", text: "Hei! Hva vil du ha?", en: "Hello! What would you like?" },
        { speaker: "Kari", text: "Jeg vil ha en kaffe, takk.", en: "I would like a coffee, thank you." },
        { speaker: "Servitør", text: "Vil du ha melk i kaffen?", en: "Would you like milk in the coffee?" },
        { speaker: "Kari", text: "Ja, takk. Og litt brød.", en: "Yes please. And a little bread." },
        { speaker: "Servitør", text: "Det blir femti kroner.", en: "That comes to fifty kroner." },
        { speaker: "Kari", text: "Her er det. Ha det bra!", en: "Here you are. Goodbye!" },
      ],
      questions: [
        { id: "q1", q: "What does Kari order?", choices: ["Tea", "Coffee and bread", "Water only", "Fish"], answer: "Coffee and bread" },
        { id: "q2", q: "Does she want milk?", choices: ["Yes", "No", "She does not say", "Only water"], answer: "Yes" },
        { id: "q3", q: "How much does it cost?", choices: ["Fifty kroner", "Five kroner", "Fifteen kroner", "It is free"], answer: "Fifty kroner" },
        { id: "q4", q: "How does Kari say goodbye?", choices: ["Hei", "Ha det bra", "Takk", "Unnskyld"], answer: "Ha det bra" },
      ],
    },
    {
      id: "nb-story-familien",
      title: "Familien til Lars",
      titleEn: "Lars's family",
      icon: "👨‍👩‍👧",
      requiresSkills: 4,
      lines: [
        { speaker: "Lars", text: "Familien min er stor. Jeg har en bror og en søster.", en: "My family is big. I have a brother and a sister." },
        { speaker: "Lars", text: "Moren min er lærer, og faren min er lege.", en: "My mother is a teacher, and my father is a doctor." },
        { speaker: "Ingrid", text: "Bor bestemoren din hos dere?", en: "Does your grandmother live with you?" },
        { speaker: "Lars", text: "Ja, hun bor hos oss. Og vi har en hund.", en: "Yes, she lives with us. And we have a dog." },
      ],
      questions: [
        { id: "q1", q: "How many siblings does Lars have?", choices: ["One brother and one sister", "Two brothers", "None", "Three sisters"], answer: "One brother and one sister" },
        { id: "q2", q: "What does Lars's father do?", choices: ["Teacher", "Doctor", "Driver", "Chef"], answer: "Doctor" },
        { id: "q3", q: "Who lives with the family?", choices: ["The grandmother", "The uncle", "Nobody", "A friend"], answer: "The grandmother" },
        { id: "q4", q: "What pet do they have?", choices: ["A cat", "A dog", "A bird", "A horse"], answer: "A dog" },
      ],
    },
  ],
  "sv-en": [
    {
      id: "sv-story-cafeet",
      title: "På caféet",
      titleEn: "At the café",
      icon: "☕",
      requiresSkills: 2,
      lines: [
        { speaker: "Servitör", text: "Hej! Vad vill du ha?", en: "Hello! What would you like?" },
        { speaker: "Erik", text: "Jag vill ha en kaffe, tack.", en: "I would like a coffee, thank you." },
        { speaker: "Servitör", text: "Vill du ha mjölk i kaffet?", en: "Would you like milk in the coffee?" },
        { speaker: "Erik", text: "Ja, tack. Och lite bröd.", en: "Yes please. And a little bread." },
        { speaker: "Servitör", text: "Det blir femtio kronor.", en: "That comes to fifty kronor." },
        { speaker: "Erik", text: "Här är det. Hej då!", en: "Here you are. Goodbye!" },
      ],
      questions: [
        { id: "q1", q: "What does Erik order?", choices: ["Tea", "Coffee and bread", "Water only", "Fish"], answer: "Coffee and bread" },
        { id: "q2", q: "Does he want milk?", choices: ["Yes", "No", "He does not say", "Only water"], answer: "Yes" },
        { id: "q3", q: "How much does it cost?", choices: ["Fifty kronor", "Five kronor", "Fifteen kronor", "It is free"], answer: "Fifty kronor" },
      ],
    },
    {
      id: "sv-story-familjen",
      title: "Eriks familj",
      titleEn: "Erik's family",
      icon: "👨‍👩‍👧",
      requiresSkills: 4,
      lines: [
        { speaker: "Erik", text: "Min familj är stor. Jag har en bror och en syster.", en: "My family is big. I have a brother and a sister." },
        { speaker: "Erik", text: "Min mamma är lärare och min pappa är läkare.", en: "My mother is a teacher and my father is a doctor." },
        { speaker: "Anna", text: "Bor din mormor hos er?", en: "Does your grandmother live with you?" },
        { speaker: "Erik", text: "Ja, hon bor hos oss. Vi har också en katt.", en: "Yes, she lives with us. We also have a cat." },
      ],
      questions: [
        { id: "q1", q: "How many siblings does Erik have?", choices: ["One brother and one sister", "Two brothers", "None", "Three sisters"], answer: "One brother and one sister" },
        { id: "q2", q: "What does Erik's father do?", choices: ["Teacher", "Doctor", "Driver", "Chef"], answer: "Doctor" },
        { id: "q3", q: "Who lives with the family?", choices: ["The grandmother", "The uncle", "Nobody", "A friend"], answer: "The grandmother" },
        { id: "q4", q: "What pet do they have?", choices: ["A dog", "A cat", "A bird", "A horse"], answer: "A cat" },
      ],
    },
  ],
};

const BUILT_IN = [SPANISH, FRENCH, GERMAN, ITALIAN, NORWEGIAN, SWEDISH];

// Drop-in courses are picked up automatically — no registry edit needed. The top-level
// await is transparent to every existing static importer of this module.
const extra = await loadExtraCourses(EXTRA_COURSES_DIR, BUILT_IN.map((c) => c.id));
Object.assign(STORIES, extra.stories);

export const COURSES = [...BUILT_IN, ...extra.courses];

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
