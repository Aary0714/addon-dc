require(`dotenv`).config();
const axios = require(`axios`);
const fs = require(`fs`);
const path = require(`path`);

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const OMDB_API_KEY = process.env.OMDB_API_KEY;
const BASE_URL = `https://api.themoviedb.org/3`;
const OUTPUT_PATH = path.join(__dirname, `..`, `Data`, `moviesData.js`);
const DC_COMPANY_IDS = `9993|184898|128064`;
const SUPPLEMENTARY_LIST_IDS = [3, 94805, 105614];
const ANIMATION_GENRE_ID = 16;

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

async function getMovieDetails(tmdbId) {
  try {
    return await tmdbGet(`/movie/${tmdbId}`);
  } catch (err) {
    return null;
  }
}

async function getExternalIds(tmdbId) {
  try {
    return await tmdbGet(`/movie/${tmdbId}/external_ids`);
  } catch (err) {
    return {};
  }
}

async function getOmdbRatings(imdbId) {
  if (!OMDB_API_KEY || !imdbId) return [];
  try {
    const res = await axios.get(`http://www.omdbapi.com/`, {
      params: { i: imdbId, apikey: OMDB_API_KEY }
    });
    return res.data && Array.isArray(res.data.Ratings) ? res.data.Ratings : [];
  } catch (err) {
    return [];
  }
}

function loadExisting() {
  try {
    delete require.cache[require.resolve(OUTPUT_PATH)];
    const data = require(OUTPUT_PATH);
    return Array.isArray(data) ? data : [];
  } catch (err) {
    return [];
  }
}

async function fetchDiscoveredMovies() {
  const results = [];
  let page = 1, totalPages = 1;
  do {
    const data = await tmdbGet(`/discover/movie`, {
      with_companies: DC_COMPANY_IDS,
      without_genres: ANIMATION_GENRE_ID,
      sort_by: `primary_release_date.asc`,
      [`primary_release_date.gte`]: `1900-01-01`,
      page
    });
    totalPages = data.total_pages;
    results.push(...data.results);
    page++;
  } while (page <= totalPages && page <= 20);
  return results;
}

async function fetchListMovies(listId) {
  try {
    const data = await tmdbGet(`/list/${listId}`);
    return (data.items || []).filter(i => !i.media_type || i.media_type === `movie`);
  } catch (err) {
    console.warn(`Could not fetch list ${listId}: ${err.message}`);
    return [];
  }
}

function sortByReleaseYear(a, b) {
  const ya = parseInt(a.releaseYear, 10);
  const yb = parseInt(b.releaseYear, 10);
  if (isNaN(ya) && isNaN(yb)) return 0;
  if (isNaN(ya)) return 1;
  if (isNaN(yb)) return -1;
  return ya - yb;
}

(async () => {
  try {
    const existing = loadExisting();
    const existingTmdbIds = new Set(existing.map(i => i.tmdbId));
    console.log(`Existing movies in file: ${existing.length}`);

    console.log(`Discovering DC movies by production company...`);
    const companyResults = await fetchDiscoveredMovies();
    console.log(`  -> ${companyResults.length} candidates from company discovery`);

    let listResults = [];
    for (const listId of SUPPLEMENTARY_LIST_IDS) {
      const items = await fetchListMovies(listId);
      console.log(`  -> ${items.length} items from list ${listId}`);
      listResults.push(...items);
    }

    const candidateMap = new Map();
    for (const r of [...companyResults, ...listResults]) {
      if (!r.id) continue;
      if (existingTmdbIds.has(r.id)) continue;
      if (!candidateMap.has(r.id)) candidateMap.set(r.id, r);
    }
    console.log(`New unique candidates to process: ${candidateMap.size}`);

    const newItems = [];
    for (const [tmdbId] of candidateMap) {
      const details = await getMovieDetails(tmdbId);
      if (!details) continue;
      if (!details.poster_path || !details.title) continue;
      const genreIds = (details.genres || []).map(g => g.id);
      if (genreIds.includes(ANIMATION_GENRE_ID)) continue;

      const externalIds = await getExternalIds(tmdbId);
      const realImdbId = externalIds.imdb_id || null;
      const imdbIdForSchema = realImdbId || `tmdb_${tmdbId}`;
      const ratings = await getOmdbRatings(realImdbId);

      newItems.push({
        tmdbId: tmdbId,
        title: details.title,
        type: `movie`,
        imdbId: imdbIdForSchema,
        id: `dc_${imdbIdForSchema}`,
        releaseYear: details.release_date ? details.release_date.split(`-`)[0] : `N/A`,
        poster: `https://image.tmdb.org/t/p/w500${details.poster_path}`,
        ratings: ratings,
        genres: details.genres || []
      });
      console.log(`  + Added: ${details.title} (${details.release_date || `N/A`})`);
    }

    const combined = [...existing, ...newItems];
    combined.sort(sortByReleaseYear);

    const fileContent = `module.exports = ${JSON.stringify(combined, null, 2)};\n`;
    fs.writeFileSync(OUTPUT_PATH, fileContent, `utf8`);
    console.log(`Saved ${combined.length} total movies to Data/moviesData.js (${newItems.length} new)`);
  } catch (err) {
    console.error(`Error updating movies data:`, err.message);
    process.exit(1);
  }
})();
