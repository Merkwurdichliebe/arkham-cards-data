const promisify = require("util").promisify;
const fs = require("fs");
const path = require("path");
const PO = require("pofile");
const getFilePaths = require("./utils/getFilePaths");
const unorm = require('unorm');

const loadPOFile = promisify(PO.load);

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const exists = promisify(fs.exists);
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);

/** Asynchronous filtering of an array. */
const asyncFilter = async (arr, predicate) =>
  Promise.all(arr.map(predicate)).then(results =>
    arr.filter((_v, index) => results[index])
  );

/**
 * Get entries from a PO file.
 *
 * @param {string} filePath - The path to the PO file.
 * @returns {PO.Item[]} An array of PO items
 */
async function getPOFile(filePath) {
  try {
    const poFile = await loadPOFile(filePath);
    return poFile;
  } catch (err) {
    throw new Error("Could not load PO entries : " + err);
  }
}

/**
 * Read JSON from file.
 *
 * @param {string} filePath - The path to the JSON file.
 * @returns {object} The object read from JSON.
 */
async function readJSON(filePath) {
  try {
    const rawData = await readFile(filePath, 'utf8');
    return JSON.parse(rawData);
  } catch (err) {
    throw new Error("Could not load JSON file : " + err);
  }
}

/**
 * Write an object to JSON file.
 *
 * @param {object} object - The object to write as JSON in a file
 * @param {string} filePath - The path to write to
 */
async function writeJSON(object, filePath) {
  try {
    console.log(`Creating directory for file: ${filePath} - ${path.dirname(filePath)}`)
    fs.mkdirSync(path.dirname(filePath), { recursive: true }, err => {
      console.log(err);
    });
    writeFile(filePath, JSON.stringify(object, null, 2));
  } catch (err) {
    throw new Error("Could not write JSON file: " + filePath + err);
  }
}

const TRANSLATEABLE_KEYS = new Set(['text', 'title', 'subtext', 'name', 'description', 'confirm_text', 'scenario_name', 'full_name']);

/**
 * Recursively translate an object using entries from a PO file.
 * The object is modified in place.
 * It will only translate `text` properties.
 *
 * @param {object} object - The object to translate
 * @param {PO} poFile - The PO file to use for translation
 * @param {object} allPoEntries - All entities we have seen to date
 */
async function translate(object, poFile, allPoEntries) {
  for (const prop in object) {
    if (object.hasOwnProperty(prop)) {
      if (TRANSLATEABLE_KEYS.has(prop) && typeof object[prop] === "string") {
        const normalized = unorm.nfc(object[prop]);
        let foundPoEntry = allPoEntries[normalized];
        if (!foundPoEntry) {
          foundPoEntry = poFile.items.find(e => unorm.nfc(e.msgid) === normalized);
        }
        if (foundPoEntry !== undefined) {
          if (foundPoEntry.msgstr && foundPoEntry.msgstr.length && foundPoEntry.msgstr[0]) {
            object[prop] = foundPoEntry.msgstr[0];
          }
        } else {
          const item = new PO.Item();
          item.msgid = object[prop];
          poFile.items.push(item);
        }
      }
      if (typeof object[prop] === "object") {
        // Recursion
        translate(object[prop], poFile, allPoEntries);
      }
    }
  }
}

const SETTINGS_FOR_LANGUAGE = {
  fr: {
    'Language': 'fr',
    'Plural-Forms': 'nplurals=2; plural=(n > 1);',
  },
  es: {
    'Language': 'es',
    'Plural-Forms': 'nplurals=2; plural=(n != 1);',
  },
  de: {
    'Language': 'de',
    'Plural-Forms': 'nplurals=2; plural=(n != 1);',
  },
  it: {
    'Language': 'it',
    'Plural-Forms': 'nplurals=2; plural=(n != 1);',
  },
  ru: {
    'Language': 'ru',
    'Plural-Forms': 'nplurals=3; plural=(n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<12 || n%100>14) ? 1 : 2);',
  },
};

async function getOrCreatePOFile(scenarioPoFile, localeCode, scenario) {
  if (await exists(scenarioPoFile)) {
    console.log("(" + localeCode + ") Translating " + scenario);
    return await getPOFile(scenarioPoFile);
  }
  console.log("(" + localeCode + ") No translation found for scenario " + scenario + ". Creating placeholder file.");
  const po = new PO();
  po.headers = SETTINGS_FOR_LANGUAGE[localeCode];
  return po;
}

/**
 * Read the encounter sets.
 * @param {string} localeCode  - Locale code (en, es, ...)
 */
async function readEncounterSets(localeCode) {
  const json = await readJSON(`encounter_sets/${localeCode}.json`);
  const encounter_sets = {};
  for(let i = 0; i < json.length; i++) {
    const entry = json[i];
    encounter_sets[entry.code] = entry.name;
  }
  return encounter_sets;
}

/**
 * Generate localized JSON files for a specific locale.
 *
 * @param {string} localeCode - Locale code (fr, it, es ...)
 */
async function generateLocale(localeCode) {
  const allPoEntries = {};
  const allScenarios = getFilePaths("./campaigns");
  const allReturnScenarios = getFilePaths("./return_campaigns");
  const printErr = (err) => {
    if (err) {
      console.log(err);
    }
  };
  for (const scenario of [...allScenarios, ...allReturnScenarios].sort()) {
    if (scenario.indexOf(".DS_Store") !== -1) {
      continue;
    }
    const scenarioPoFile =
      "i18n/" + localeCode + "/" + scenario.replace(/json$/, "po");
    const poFile = await getOrCreatePOFile(scenarioPoFile, localeCode, scenario);
    const scenarioDesc = await readJSON(scenario);

    await translate(scenarioDesc, poFile, allPoEntries);
    await writeJSON(
      scenarioDesc,
      "build/i18n/" + localeCode + "/" + scenario
    );
    fs.mkdirSync(path.dirname(scenarioPoFile), { recursive: true }, (err) => {
      console.log(err)
    });
    poFile.save(scenarioPoFile, printErr);

    const encounter_sets = await readEncounterSets('en');
    await writeJSON(
      encounter_sets,
      "encounter_sets.json"
    );
    const lang_encounter_sets = await readEncounterSets(localeCode);
    for (const code of Object.keys(lang_encounter_sets)) {
      encounter_sets[code] = lang_encounter_sets[code];
    }
    await writeJSON(
      encounter_sets,
      "build/i18n/" + localeCode + "/encounter_sets.json"
    )
    for (const item of poFile.items) {
      allPoEntries[unorm.nfc(item.msgid)] = item;
    }
  }
}

/**
 * Get the list of available locales by reading folders under i18n
 *
 * @returns {string[]} The list of available locales
 */
async function getAvailableLocales() {
  const entries = await readdir("i18n");
  return asyncFilter(entries, async e => {
    return !(await stat("i18n/" + e)).isFile();
  });
}

async function run() {
  const localeCodes = await getAvailableLocales();
  for (const localeCode of localeCodes) {
    console.log("Generating translations for " + localeCode);
    await generateLocale(localeCode);
  }
}


run();
