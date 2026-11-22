// Convert a private Mongo JSON/JSONL export to canonical Extended JSON dates.
// Documents and credentials are written only to the supplied private output file.
const fs = require('node:fs');
const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Provide input and private output paths');
const text = fs.readFileSync(input, 'utf8').replace(/^\uFEFF/, '').trim();
const documents = text.startsWith('[') ? JSON.parse(text)
  : text.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
if (!Array.isArray(documents)) throw new Error('Expected a document array');
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    if (Object.keys(value).length === 1 && typeof value.$date === 'string') {
      const milliseconds = Date.parse(value.$date);
      if (!Number.isFinite(milliseconds)) throw new Error('Invalid date in export');
      return { $date: { $numberLong: String(milliseconds) } };
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]));
  }
  return value;
}
fs.writeFileSync(output, JSON.stringify(normalize(documents)));
