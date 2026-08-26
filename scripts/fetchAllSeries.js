require(`dotenv`).config();
const axios = require(`axios`);
const fs = require(`fs`);
const path = require(`path`);

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const BASE_URL = `https://api.themoviedb.org/3`;
const OUTPUT_PATH = path.join(__dirname, `..`, `Data`, `seriesData.js`);
const DC_COMPANY_IDS = `9993|184898|128064|2785`;

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

async function getImdbId(tmdbId) {
  try {
    const data = await tmdbGet(`/tv/${tmdbId}/external_ids`);
    return data.imdb_id || null;
  } catch (err) {
    return null;
  }
}

async function fetchDiscoveredSeries() {
  const results = [];
  let page = 1, totalPages = 1;
  do {
    const data = await tmdbGet(`/discover/tv`, {
      with_companies: DC_COMPANY_IDS,
      without_genres: 16,
      sort_by: `first_air_date.asc`,
      "first_air_date.gte": `1900-01-01`,
      page
    });
    totalPages = data.total_pages;
    results.push(...data.results.filter(r => r.poster_path && r.overview));
    page++;
  } while (page <= totalPages && page <= 20);
  return results;
}

(async () => {
  try {
    console.log(`Discovering DC series from TMDb...`);
    const discovered = await fetchDiscoveredSeries();
    console.log(`  -> ${discovered.length} candidates found`);

    const finalItems = [];
    for (const r of discovered) {
      const imdbId = await getImdbId(r.id);
      finalItems.push({
        id: imdbId || `tmdb_${r.id}`,
        imdbId: imdbId || null,
        tmdbId: r.id,
        type: `series`,
        title: r.name,
        poster: `https://image.tmdb.org/t/p/w500${r.poster_path}`,
        overview: r.overview || ``,
        releaseYear: r.first_air_date ? r.first_air_date.split(`-`)[0] : `N/A`,
        releaseDate: r.first_air_date || null
      });
    }

    finalItems.sort((a, b) => {
      if (!a.releaseDate) return 1;
      if (!b.releaseDate) return -1;
      return new Date(a.releaseDate) - new Date(b.releaseDate);
    });

    const fileContent = `module.exports = ${JSON.stringify(finalItems, null, 2)};\n`;
    fs.writeFileSync(OUTPUT_PATH, fileContent, `utf8`);
    console.log(`Saved ${finalItems.length} total series to Data/seriesData.js`);
  } catch (err) {
    console.error(`Error updating series data:`, err.message);
    process.exit(1);
  }
})();
