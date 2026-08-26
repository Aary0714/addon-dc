require(`dotenv`).config();
const axios = require(`axios`);
const fs = require(`fs`);
const path = require(`path`);

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const BASE_URL = `https://api.themoviedb.org/3`;
const OUTPUT_PATH = path.join(__dirname, `..`, `Data`, `dcu.json`);

if (!TMDB_API_KEY) {
  console.error(`Missing TMDB_API_KEY in environment.`);
  process.exit(1);
}

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
  const releaseDate = item.release_date || item.first_air_date || ``;
  const imdbId = await getImdbId(item.id, type);
  return {
    id: imdbId || `tmdb_${item.id}`,
    imdbId: imdbId || null,
    tmdbId: item.id,
    type,
    title: item.title || item.name,
    poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null,
    overview: item.overview || ``,
    releaseYear: releaseDate ? releaseDate.split(`-`)[0] : `N/A`,
    releaseDate: releaseDate || null
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

(async () => {
  try {
    console.log(`Fetching DCU (James Gunn universe)...`);
    const dcu = await fetchDCU();

    dcu.sort((a, b) => {
      if (!a.releaseDate) return 1;
      if (!b.releaseDate) return -1;
      return new Date(a.releaseDate) - new Date(b.releaseDate);
    });

    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(dcu, null, 2));
    console.log(`  -> ${dcu.length} items saved to Data/dcu.json`);
  } catch (err) {
    console.error(`Error updating DCU catalog:`, err.message);
    process.exit(1);
  }
})();
