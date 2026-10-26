#!/usr/bin/env node
// Collects every Persian UI string from the app's sources, so the English and Arabic
// dictionaries in public/lang/ can be checked for gaps (tests/i18n.test.js) or extended.
//
// A string is the text between HTML tags inside a JS string literal, template literal or
// static HTML. Template expressions become numbered placeholders: `تیم ${name} برنده شد`
// is collected as "تیم {0} برنده شد", which public/i18n.js matches at runtime as a pattern.
//
//   node scripts/i18n_extract.cjs            -> prints the strings as JSON
//   node scripts/i18n_extract.cjs --missing  -> only those missing from en.js or ar.js
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SOURCES = [
    ...fs.readdirSync(path.join(ROOT, 'public'))
        .filter(f => /\.(html|js)$/.test(f) && !['sw.js', 'i18n.js'].includes(f))
        .map(f => 'public/' + f),
    'server.js',
    ...fs.readdirSync(path.join(ROOT, 'routes')).map(f => 'routes/' + f),
    ...fs.readdirSync(path.join(ROOT, 'lib')).filter(f => f !== 'notify.js').map(f => 'lib/' + f),
    'cpanel_export/api.php'
];

const FA = /[؀-ۿ]/;
const FA_LETTER = /[\u0621-\u064A\u067E\u0686\u0698\u06A9\u06AF\u06CC\u06C0]/;
// UI text has at least two letters; single letters are keyboard shortcuts or lookup tables.
// Arabic text (ي ك ة, never used in Persian) is a translation already, not a source string.
const isText = s => (s.match(new RegExp(FA_LETTER.source, 'g')) || []).length >= 2 && !/[يكة]/.test(s);

// Splits a literal's text into the visible segments: text between tags, plus the values
// of attributes a person reads (title, placeholder, aria-label, alt, data-title).
function segments(text) {
    const out = [];
    const tagRe = /<\/?[a-zA-Z][^<>]*>/g;
    let last = 0, m;
    // Attributes written outside a full tag ('readonly title="..."') are read as attributes too.
    const push = s => out.push(s.replace(/\b(?:title|placeholder|aria-label)\s*=\s*(["'])([\s\S]*?)\1/g, (_, q, v) => { out.push(v); return ' '; }));
    while ((m = tagRe.exec(text))) {
        push(text.slice(last, m.index));
        const attrRe = /\b(?:title|placeholder|aria-label|alt|data-title|label|value)\s*=\s*(["'])([\s\S]*?)\1/g;
        let a;
        while ((a = attrRe.exec(m[0]))) push(a[2]);
        last = m.index + m[0].length;
    }
    push(text.slice(last));
    return out;
}

// Renumbers placeholders so each collected string starts at {0}.
function normalize(s) {
    let n = 0;
    const map = {};
    s = s.replace(/\{(\d+)\}/g, (_, d) => { if (!(d in map)) map[d] = n++; return '{' + map[d] + '}'; });
    return s.replace(/\s+/g, ' ').trim();
}

// Reads one backslash escape at src[i]; returns how many characters it used.
function unescape1(src, i, put) {
    const c = src[i + 1];
    const u = /^u([0-9a-fA-F]{4})/.exec(src.slice(i + 1, i + 6));
    if (u) { put(String.fromCharCode(parseInt(u[1], 16))); return 6; }
    put(c === 'n' || c === 't' ? ' ' : c);
    return 2;
}

function addText(text, file, out) {
    for (const seg of segments(text)) {
        // Template fragments around tags often carry stray quotes/operators; keep the readable part.
        const s = normalize(seg);
        if (!isText(s)) continue;
        if (!out.has(s)) out.set(s, new Set());
        out.get(s).add(file);
    }
}

// Minimal JS/PHP lexer: finds string and template literals, skipping comments and regexes.
function scanCode(src, file, out, php) {
    let i = 0;
    const n = src.length;
    let prevSignificant = '';
    function readTemplate() {
        // at src[i] === '`'
        i++;
        let text = '', ph = 0;
        while (i < n) {
            const c = src[i];
            if (c === '\\') { i += unescape1(src, i, t => { text += t; }); continue; }
            if (c === '`') { i++; break; }
            if (c === '$' && src[i + 1] === '{') {
                i += 2;
                const start = i;
                let depth = 1;
                while (i < n && depth) {
                    const d = src[i];
                    if (d === '{') depth++;
                    else if (d === '}') { depth--; if (!depth) break; }
                    else if (d === '`') { readTemplateNested(); continue; }
                    else if (d === "'" || d === '"') { readQuoted(d); continue; }
                    i++;
                }
                scanCode(src.slice(start, i), file, out, php);
                i++;
                text += '{' + (ph++) + '}';
                continue;
            }
            text += c;
            i++;
        }
        return text;
    }
    function readTemplateNested() { readTemplate(); }
    function readQuoted(q) {
        i++;
        let text = '';
        while (i < n) {
            const c = src[i];
            if (c === '\\') { i += unescape1(src, i, t => { text += t; }); continue; }
            if (c === q) { i++; break; }
            if (c === '\n' && !php) break;
            if (php && q === '"' && c === '$' && /[a-zA-Z_{]/.test(src[i + 1] || '')) {
                // PHP interpolation "...$var..." / "{$x['y']}"
                if (src[i + 1] === '{') { let d = 0; while (i < n) { if (src[i] === '{') d++; if (src[i] === '}') { d--; if (!d) { i++; break; } } i++; } }
                else { i++; while (i < n && /[\w\[\]'>-]/.test(src[i]) && !(src[i] === '-' && src[i + 1] !== '>')) i++; }
                text += '{' + (text.match(/\{\d+\}/g) || []).length + '}';
                continue;
            }
            text += c;
            i++;
        }
        return text;
    }
    while (i < n) {
        const c = src[i];
        if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
        if (php && c === '#') { while (i < n && src[i] !== '\n') i++; continue; }
        if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2); if (i < 0) break; i += 2; continue; }
        if (c === '/' && !php && /[(,=:[!&|?{};+\-*%<>~^]|^$|return$/.test(prevSignificant)) {
            // regex literal
            i++;
            let inClass = false;
            while (i < n && src[i] !== '\n') {
                if (src[i] === '\\') { i += 2; continue; }
                if (src[i] === '[') inClass = true;
                else if (src[i] === ']') inClass = false;
                else if (src[i] === '/' && !inClass) break;
                i++;
            }
            i++;
            prevSignificant = 'x';
            continue;
        }
        if (c === '`' && !php) { addText(readTemplate(), file, out); prevSignificant = 'x'; continue; }
        if (c === "'" || c === '"') { addText(readQuoted(c), file, out); prevSignificant = 'x'; continue; }
        if (!/\s/.test(c)) {
            if (/[A-Za-z_$0-9]/.test(c)) {
                let w = '';
                while (i < n && /[A-Za-z_$0-9]/.test(src[i])) w += src[i++];
                prevSignificant = w === 'return' || w === 'typeof' ? 'return' : 'x';
                continue;
            }
            prevSignificant = c;
        }
        i++;
    }
}

function scanHtml(src, file, out) {
    const re = /<script\b[^>]*>([\s\S]*?)<\/script>|<style\b[^>]*>[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi;
    let last = 0, m;
    while ((m = re.exec(src))) {
        addText(src.slice(last, m.index), file, out);
        if (m[1] !== undefined) scanCode(m[1], file, out, false);
        last = m.index + m[0].length;
    }
    addText(src.slice(last), file, out);
}

function extract() {
    const out = new Map();
    for (const rel of SOURCES) {
        const full = path.join(ROOT, rel);
        if (!fs.existsSync(full)) continue;
        const src = fs.readFileSync(full, 'utf8');
        if (rel.endsWith('.html')) scanHtml(src, rel, out);
        else scanCode(src, rel, out, rel.endsWith('.php'));
    }
    return out;
}

function loadDict(lang) {
    const file = path.join(ROOT, 'public', 'lang', lang + '.js');
    if (!fs.existsSync(file)) return {};
    let dict = {};
    const I18N = { register: (l, d) => { dict = Object.assign(dict, d); } };
    new Function('I18N', fs.readFileSync(file, 'utf8'))(I18N);
    return dict;
}

module.exports = { extract, loadDict, FA, FA_LETTER };

if (require.main === module) {
    const all = extract();
    let keys = [...all.keys()];
    if (process.argv.includes('--missing')) {
        const en = loadDict('en'), ar = loadDict('ar');
        keys = keys.filter(k => !(k in en) || !(k in ar));
    }
    const withFiles = process.argv.includes('--files');
    const res = withFiles ? Object.fromEntries(keys.map(k => [k, [...all.get(k)]])) : keys;
    process.stdout.write(JSON.stringify(res, null, 1) + '\n');
}
