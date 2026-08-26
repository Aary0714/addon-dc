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

function toItem(item, type) {
  const tmdbId = item.id;
  const posterPath = item.poster_path;
  const releaseDate = item.release_date || item.first_air_date || ``;
  return {
    id: `tmdb_${tmdbId}`,
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
    results.push(...data.results.map(r => toItem(r, `movie`)));
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
    results.push(...data.results.map(r => toItem(r, `series`)));
    page++;
  } while (page <= totalPages);

  return results;
}

async function fetchDCUAOM() {
  const LIST_ID = 3255;
  const data = await tmdbGet(`/list/${LIST_ID}`);
  const items = data.items || [];
  return items.map(function (r) {
    const kind = r.media_type === `tv` ? `series` : `movie`;
    return toItem(r, kind);
  });
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
