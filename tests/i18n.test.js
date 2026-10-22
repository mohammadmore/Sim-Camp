// The English and Arabic dictionaries cover every Persian string in the app, and keep
// the placeholders of each string.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { extract, loadDict } = require('../scripts/i18n_extract.cjs');
const strings = [...extract().keys()];
const placeholders = s => (s.match(/\{\d+\}/g) || []).sort().join();

for (const lang of ['en', 'ar']) {
    test(`i18n: ${lang} dictionary covers every interface string`, () => {
        const dict = loadDict(lang);
        const missing = strings.filter(s => !(s in dict));
        assert.deepEqual(missing, [], `missing in public/lang/${lang}.js (node scripts/i18n_extract.cjs --missing)`);
        const broken = Object.keys(dict).filter(k => placeholders(k) !== placeholders(dict[k]));
        assert.deepEqual(broken, [], 'placeholders must match');
        if (lang === 'en') assert.deepEqual(Object.keys(dict).filter(k => /[ء-يپچژکگی]/.test(dict[k].replace(/سيم كامب|العربية/g, ''))), [], 'English text has no Persian/Arabic letters');
        else assert.deepEqual(Object.keys(dict).filter(k => /[پچژگکی۰-۹]/.test(dict[k])), [], 'Arabic text has no Persian letters or digits');
    });
}
