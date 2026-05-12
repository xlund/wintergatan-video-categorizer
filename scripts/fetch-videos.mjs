/**
 * Fetches all videos from the Wintergatan YouTube channel.
 *
 * Usage:
 *   YOUTUBE_API_KEY=<key> CHANNEL_ID=<id> node scripts/fetch-videos.mjs
 *
 * Output: scripts/data/raw_videos.json
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const API_KEY = process.env.YOUTUBE_API_KEY;
const CHANNEL_ID = process.env.CHANNEL_ID;

if (!API_KEY) {
  console.error('Missing YOUTUBE_API_KEY environment variable.');
  process.exit(1);
}
if (!CHANNEL_ID) {
  console.error('Missing CHANNEL_ID environment variable.');
  console.error('Find it at: https://www.youtube.com/@Wintergatan -> view page source -> search "channelId"');
  process.exit(1);
}

const BASE = 'https://www.googleapis.com/youtube/v3';

async function apiFetch(path, params) {
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set('key', API_KEY);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`YouTube API error ${res.status}: ${body}`);
  }
  return res.json();
}

async function getUploadsPlaylistId() {
  const data = await apiFetch('/channels', {
    part: 'contentDetails',
    id: CHANNEL_ID,
    maxResults: 1,
  });
  const playlistId = data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!playlistId) throw new Error('Could not find uploads playlist for channel.');
  return playlistId;
}

async function fetchAllPlaylistItems(playlistId) {
  const items = [];
  let pageToken = undefined;

  do {
    const params = {
      part: 'snippet',
      playlistId,
      maxResults: 50,
    };
    if (pageToken) params.pageToken = pageToken;

    const data = await apiFetch('/playlistItems', params);
    items.push(...data.items);
    pageToken = data.nextPageToken;
    console.log(`  Fetched ${items.length} playlist items so far...`);
  } while (pageToken);

  return items;
}

async function fetchVideoDetails(videoIds) {
  const results = [];
  // API allows up to 50 IDs per request
  for (let i = 0; i < videoIds.length; i += 50) {
    const chunk = videoIds.slice(i, i + 50);
    const data = await apiFetch('/videos', {
      part: 'snippet,contentDetails,statistics',
      id: chunk.join(','),
      maxResults: 50,
    });
    results.push(...data.items);
    console.log(`  Fetched details for ${results.length}/${videoIds.length} videos...`);
  }
  return results;
}

async function main() {
  console.log('Fetching uploads playlist ID...');
  const playlistId = await getUploadsPlaylistId();
  console.log(`Uploads playlist: ${playlistId}`);

  console.log('Fetching all playlist items...');
  const playlistItems = await fetchAllPlaylistItems(playlistId);
  console.log(`Total playlist items: ${playlistItems.length}`);

  const videoIds = playlistItems
    .map(item => item.snippet?.resourceId?.videoId)
    .filter(Boolean);

  console.log('Fetching video details...');
  const videoDetails = await fetchVideoDetails(videoIds);

  const videos = videoDetails.map(v => ({
    id: v.id,
    title: v.snippet.title,
    description: v.snippet.description,
    publishedAt: v.snippet.publishedAt,
    thumbnail: v.snippet.thumbnails?.medium?.url ?? v.snippet.thumbnails?.default?.url ?? '',
    tags: v.snippet.tags ?? [],
    duration: v.contentDetails?.duration ?? '',
    viewCount: v.statistics?.viewCount ?? '0',
    youtubeUrl: `https://www.youtube.com/watch?v=${v.id}`,
  }));

  // Sort oldest first — useful for the categorization pass
  videos.sort((a, b) => new Date(a.publishedAt) - new Date(b.publishedAt));

  const outDir = join(__dirname, 'data');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'raw_videos.json');
  writeFileSync(outPath, JSON.stringify(videos, null, 2));

  console.log(`\nDone. ${videos.length} videos written to ${outPath}`);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
