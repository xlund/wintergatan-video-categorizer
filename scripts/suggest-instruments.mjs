/**
 * Suggest instruments/components for videos that currently have empty instruments arrays.
 * Uses the Claude API (claude-haiku-4-5) to analyze title + description + YouTube tags.
 *
 * Prerequisites: ANTHROPIC_API_KEY must be set in the environment.
 * Run: ANTHROPIC_API_KEY=xxx node scripts/suggest-instruments.mjs
 *
 * Output: scripts/data/instrument_suggestions.json
 * Review that file, then manually apply accepted suggestions to scripts/categorize.mjs,
 * and re-run: node scripts/categorize.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  console.error('Error: ANTHROPIC_API_KEY environment variable is not set.');
  process.exit(1);
}

const VOCABULARY = [
  // Musical instruments
  'accordion', 'banjo', 'bass', 'cyber bass', 'drums', 'guitar', 'hackbrett', 'harp',
  'hi-hat', 'kick drum', 'melodica', 'musical saw', 'ondophone', 'percussion',
  'sizzle cymbal', 'snare drum', 'strings', 'tambourine', 'vibraphone', 'violin',
  // Machine components
  'bearings', 'bowden cable', 'clock', 'clutch', 'collapsable wheel', 'conveyor belt',
  'counterweight', 'damper', 'drivetrain', 'escapement', 'flyball governor', 'flywheel',
  'frame', 'gears', 'lego', 'magnets', 'marble demagnetizer', 'marble divider',
  'marble funnel', 'marble gates', 'marble lift', 'marble loop', 'marble release',
  'marble tracks', 'motor', 'muting system', 'paper pull mechanism', 'pedal',
  'programming wheel', 'resonator', 'rhythm machine', 'timing', 'trigger mechanism',
  'vibrato',
  // Engineering
  'machining', 'wiring',
  // Fallback
  'other',
];

const BATCH_SIZE = 10;

async function callClaude(prompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.content[0].text;
}

function buildPrompt(videos) {
  const vocabList = VOCABULARY.join(', ');
  const videoList = videos.map((v, i) =>
    `[${i + 1}] ID: ${v.id}
Title: ${v.title}
YouTube tags: ${(v.tags || []).join(', ') || '(none)'}
Description: ${(v.description || '').slice(0, 400) || '(none)'}`
  ).join('\n\n');

  return `You are categorizing Wintergatan YouTube videos for a catalog site. Each video needs an "instruments" array — this field covers both musical instruments AND machine components/engineering topics that are the *primary focus* of the video.

Allowed vocabulary (use ONLY these exact strings, case-sensitive):
${vocabList}

For each video below, return a JSON array of 0–4 terms from the vocabulary that are genuinely the main focus. Return empty [] for channel updates, philosophical musings, pure announcements, or live-streams where no specific component is the subject. Do not force a tag where none fits — empty is better than wrong.

Videos to categorize:
${videoList}

Respond with ONLY a JSON array of objects, one per video, in order:
[
  { "id": "...", "instruments": [...] },
  ...
]`;
}

function parseResponse(text) {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error(`Could not parse JSON from response:\n${text}`);
  return JSON.parse(match[0]);
}

async function main() {
  const rawPath = join(__dirname, 'data/raw_videos.json');
  const videosPath = join(__dirname, '../src/data/videos.json');
  const outputPath = join(__dirname, 'data/instrument_suggestions.json');

  const raw = JSON.parse(readFileSync(rawPath, 'utf8'));
  const categorized = JSON.parse(readFileSync(videosPath, 'utf8'));

  const emptyIds = new Set(
    categorized.filter(v => !v.instruments || v.instruments.length === 0).map(v => v.id)
  );

  const toProcess = raw.filter(v => emptyIds.has(v.id));
  console.log(`Found ${toProcess.length} videos with empty instruments to process.`);

  const suggestions = [];
  const batches = [];
  for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
    batches.push(toProcess.slice(i, i + BATCH_SIZE));
  }

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    console.log(`Processing batch ${b + 1}/${batches.length} (${batch.length} videos)...`);
    const prompt = buildPrompt(batch);
    let results;
    try {
      const text = await callClaude(prompt);
      results = parseResponse(text);
    } catch (err) {
      console.error(`Batch ${b + 1} failed: ${err.message}`);
      // Store empty suggestions for this batch so we can continue
      results = batch.map(v => ({ id: v.id, instruments: [] }));
    }
    // Enrich with title for readability
    const idToTitle = Object.fromEntries(batch.map(v => [v.id, v.title]));
    for (const r of results) {
      suggestions.push({ id: r.id, title: idToTitle[r.id] || '', suggested: r.instruments || [] });
    }
  }

  writeFileSync(outputPath, JSON.stringify(suggestions, null, 2));
  console.log(`\nDone. Suggestions written to scripts/data/instrument_suggestions.json`);
  console.log(`Review that file, then apply accepted suggestions to scripts/categorize.mjs.`);

  // Print a quick summary of non-empty suggestions
  const nonEmpty = suggestions.filter(s => s.suggested.length > 0);
  console.log(`\n${nonEmpty.length}/${suggestions.length} videos got at least one suggestion:`);
  for (const s of nonEmpty.slice(0, 20)) {
    console.log(`  ${s.title.slice(0, 60).padEnd(60)} → [${s.suggested.join(', ')}]`);
  }
  if (nonEmpty.length > 20) console.log(`  ... and ${nonEmpty.length - 20} more`);
}

main().catch(err => { console.error(err); process.exit(1); });
