require(`dotenv`).config();
const axios = require(`axios`);
const fs = require(`fs`);
const path = require(`path`);

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const BASE_URL = `https://api.themoviedb.org/3`;
const DATA_DIR = path.join(__dirname, `..`, `Data`);

if (!TMDB_API_KEY) {
  console.error(`Missing TMDB_API_KEY in environment.`);
  process.exit(1);
}
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

async function tmdbGet(endpoint, params = {}) {
  const res = await axios.get(`${BASE_URL}${endpoint}`, {
    params: { api_key: TMDB_API_KEY, language: `en-US`, ...params }
  });
  return res.data;
}

async function getImdbId(tmdbId, type) {
  try {
    const endpoint = type === `series` ? `/tv/${tmdbId}/external_ids` : `/movie/${tmdbId}/external_ids`;
    const data = await tmdbGet(endpoint);
    return data.imdb_id || null;
  } catch (err) {
    return null;
  }
}

async function toItem(item, type) {
  const tmdbId = item.id;
  const posterPath = item.poster_path;
  const releaseDate = item.release_date || item.first_air_date || ``;
  const imdbId = await getImdbId(tmdbId, type);
  return {
    id: imdbId || `tmdb_${tmdbId}`,
    imdbId: imdbId || null,
    tmdbId: tmdbId,
    type,
    title: item.title || item.name,
    poster: posterPath ? `https://image.tmdb.org/t/p/w500${posterPath}` : null,
    overview: item.overview || ``,
    releaseYear: releaseDate ? releaseDate.split(`-`)[0] : `N/A`
  };
}

async function fetchDCU() {
  const DC_STUDIOS_COMPANY_ID = 184898;
  const results = [];

  let page = 1, totalPages = 1;
  do {
    const data = await tmdbGet(`/discover/movie`, {
      with_companies: DC_STUDIOS_COMPANY_ID,
      "primary_release_date.gte": `2025-01-01`,
      sort_by: `primary_release_date.asc`,
      page
    });
    totalPages = data.total_pages;
    for (const r of data.results) {
      results.push(await toItem(r, `movie`));
    }
    page++;
  } while (page <= totalPages);

  page = 1; totalPages = 1;
  do {
    const data = await tmdbGet(`/discover/tv`, {
      with_companies: DC_STUDIOS_COMPANY_ID,
      "first_air_date.gte": `2024-01-01`,
      sort_by: `first_air_date.asc`,
      page
    });
    totalPages = data.total_pages;
    for (const r of data.results) {
      results.push(await toItem(r, `series`));
    }
    page++;
  } while (page <= totalPages);

  return results;
}

async function fetchDCUAOM() {
  const LIST_ID = 3255;
  const data = await tmdbGet(`/list/${LIST_ID}`);
  const items = data.items || [];
  const results = [];
  for (const r of items) {
    const kind = r.media_type === `tv` ? `series` : `movie`;
    results.push(await toItem(r, kind));
  }
  return results;
}

(async () => {
  try {
    console.log(`Fetching DCU (James Gunn universe)...`);
    const dcu = await fetchDCU();
    fs.writeFileSync(path.join(DATA_DIR, `dcu.json`), JSON.stringify(dcu, null, 2));
    console.log(`  -> ${dcu.length} items saved to Data/dcu.json`);

    console.log(`Fetching DC animated movies (DCUAOM line)...`);
    const dcuaom = await fetchDCUAOM();
    fs.writeFileSync(path.join(DATA_DIR, `dcuaom.json`), JSON.stringify(dcuaom, null, 2));
    console.log(`  -> ${dcuaom.length} items saved to Data/dcuaom.json`);

    console.log(`Both catalogs updated successfully.`);
  } catch (err) {
    console.error(`Error updating DC catalogs:`, err.message);
    process.exit(1);
  }
})();
