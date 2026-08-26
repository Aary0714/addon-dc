require(`dotenv`).config();
const axios = require(`axios`);
const fs = require(`fs`);
const path = require(`path`);

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const OMDB_API_KEY = process.env.OMDB_API_KEY;
const BASE_URL = `https://api.themoviedb.org/3`;
const OUTPUT_PATH = path.join(__dirname, `..`, `Data`, `animationsData.js`);
const ANIMATION_GENRE_ID = 16;
const DC_COMPANY_IDS = `9993|184898|128064|2785`;
const DCUAOM_LIST_ID = 3255;

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

async function getSeriesDetails(tmdbId) {
  try {
    return await tmdbGet(`/tv/${tmdbId}`);
  } catch (err) {
    return null;
  }
}

async function getMovieExternalIds(tmdbId) {
  try {
    return await tmdbGet(`/movie/${tmdbId}/external_ids`);
  } catch (err) {
    return {};
  }
}

async function getSeriesExternalIds(tmdbId) {
  try {
    return await tmdbGet(`/tv/${tmdbId}/external_ids`);
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

async function fetchAnimatedMoviesDiscover() {
  const results = [];
  let page = 1, totalPages = 1;
  do {
    const data = await tmdbGet(`/discover/movie`, {
      with_companies: DC_COMPANY_IDS,
      with_genres: ANIMATION_GENRE_ID,
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

async function fetchAnimatedSeriesDiscover() {
  const results = [];
  let page = 1, totalPages = 1;
  do {
    const data = await tmdbGet(`/discover/tv`, {
      with_companies: DC_COMPANY_IDS,
      with_genres: ANIMATION_GENRE_ID,
      sort_by: `first_air_date.asc`,
      [`first_air_date.gte`]: `1900-01-01`,
      page
    });
    totalPages = data.total_pages;
    results.push(...data.results);
    page++;
  } while (page <= totalPages && page <= 20);
  return results;
}

async function fetchDCUAOMList() {
  try {
    const data = await tmdbGet(`/list/${DCUAOM_LIST_ID}`);
    return data.items || [];
  } catch (err) {
    console.warn(`Could not fetch DCUAOM list: ${err.message}`);
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
    console.log(`Existing animated items in file: ${existing.length}`);

    console.log(`Discovering animated DC movies...`);
    const movieDiscover = await fetchAnimatedMoviesDiscover();
    console.log(`  -> ${movieDiscover.length} candidates from company discovery`);

    console.log(`Discovering animated DC series...`);
    const seriesDiscover = await fetchAnimatedSeriesDiscover();
    console.log(`  -> ${seriesDiscover.length} candidates from company discovery`);

    console.log(`Fetching DCUAOM curated list...`);
    const listItems = await fetchDCUAOMList();
    console.log(`  -> ${listItems.length} candidates from curated list`);

    const movieCandidates = new Map();
    for (const r of movieDiscover) {
      if (r.id && !existingTmdbIds.has(r.id)) movieCandidates.set(r.id, r);
    }
    for (const r of listItems) {
      if (r.media_type && r.media_type !== `movie`) continue;
      if (r.id && !existingTmdbIds.has(r.id) && !movieCandidates.has(r.id)) movieCandidates.set(r.id, r);
    }

    const seriesCandidates = new Map();
    for (const r of seriesDiscover) {
      if (r.id && !existingTmdbIds.has(r.id)) seriesCandidates.set(r.id, r);
    }
    for (const r of listItems) {
      if (r.media_type !== `tv`) continue;
      if (r.id && !existingTmdbIds.has(r.id) && !seriesCandidates.has(r.id)) seriesCandidates.set(r.id, r);
    }

    console.log(`New movie candidates: ${movieCandidates.size}, new series candidates: ${seriesCandidates.size}`);

    const newItems = [];

    for (const [tmdbId] of movieCandidates) {
      const details = await getMovieDetails(tmdbId);
      if (!details || !details.poster_path || !details.title) continue;

      const externalIds = await getMovieExternalIds(tmdbId);
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
      console.log(`  + Added movie: ${details.title} (${details.release_date || `N/A`})`);
    }

    for (const [tmdbId] of seriesCandidates) {
      const details = await getSeriesDetails(tmdbId);
      if (!details || !details.poster_path || !details.name) continue;

      const externalIds = await getSeriesExternalIds(tmdbId);
      const realImdbId = externalIds.imdb_id || null;
      const imdbIdForSchema = realImdbId || `tmdb_${tmdbId}`;
      const ratings = await getOmdbRatings(realImdbId);

      newItems.push({
        tmdbId: tmdbId,
        title: details.name,
        type: `series`,
        imdbId: imdbIdForSchema,
        id: `dc_${imdbIdForSchema}`,
        releaseYear: details.first_air_date ? details.first_air_date.split(`-`)[0] : `N/A`,
        poster: `https://image.tmdb.org/t/p/w500${details.poster_path}`,
        ratings: ratings,
        genres: details.genres || []
      });
      console.log(`  + Added series: ${details.name} (${details.first_air_date || `N/A`})`);
    }

    const combined = [...existing, ...newItems];
    combined.sort(sortByReleaseYear);

    const fileContent = `module.exports = ${JSON.stringify(combined, null, 2)};\n`;
    fs.writeFileSync(OUTPUT_PATH, fileContent, `utf8`);
    console.log(`Saved ${combined.length} total items to Data/animationsData.js (${newItems.length} new)`);
  } catch (err) {
    console.error(`Error updating animations data:`, err.message);
    process.exit(1);
  }
})();
