require(`dotenv`).config();
const axios = require(`axios`);
const fs = require(`fs`);
const path = require(`path`);

const TMDB_API_KEY = process.env.TMDB_API_KEY;
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

async function getImdbId(tmdbId, type) {
  try {
    const endpoint = type === `series` ? `/tv/${tmdbId}/external_ids` : `/movie/${tmdbId}/external_ids`;
    const data = await tmdbGet(endpoint);
    return data.imdb_id || null;
  } catch (err) {
    return null;
  }
}

async function getMovieDetails(tmdbId) {
  try {
    return await tmdbGet(`/movie/${tmdbId}`);
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
    releaseYear: releaseDate ? releaseDate.split(`-`)[0] : `N/A`,
    releaseDate: releaseDate || null
  };
}

async function fetchAnimatedMoviesDiscover() {
  const results = [];
  let page = 1, totalPages = 1;
  do {
    const data = await tmdbGet(`/discover/movie`, {
      with_companies: DC_COMPANY_IDS,
      with_genres: ANIMATION_GENRE_ID,
      sort_by: `primary_release_date.asc`,
      "primary_release_date.gte": `1900-01-01`,
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
      "first_air_date.gte": `1900-01-01`,
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

(async () => {
  try {
    console.log(`Discovering DC animated movies...`);
    const movieDiscover = await fetchAnimatedMoviesDiscover();
    console.log(`  -> ${movieDiscover.length} candidates from company discovery`);

    console.log(`Fetching DCUAOM curated list...`);
    const listItems = await fetchDCUAOMList();
    console.log(`  -> ${listItems.length} candidates from curated list`);

    console.log(`Discovering DC animated series...`);
    const seriesDiscover = await fetchAnimatedSeriesDiscover();
    console.log(`  -> ${seriesDiscover.length} candidates from company discovery`);

    const movieById = new Map();
    for (const r of movieDiscover) {
      if (r.id) movieById.set(r.id, r);
    }
    for (const r of listItems) {
      if (r.media_type && r.media_type !== `movie`) continue;
      if (r.id && !movieById.has(r.id)) movieById.set(r.id, r);
    }

    const seriesById = new Map();
    for (const r of seriesDiscover) {
      if (r.id) seriesById.set(r.id, r);
    }
    for (const r of listItems) {
      if (r.media_type !== `tv`) continue;
      if (r.id && !seriesById.has(r.id)) seriesById.set(r.id, r);
    }

    console.log(`Total unique movies: ${movieById.size}, unique series: ${seriesById.size}`);

    const finalItems = [];

    for (const [tmdbId, r] of movieById) {
      let posterPath = r.poster_path;
      let overview = r.overview;
      let releaseDate = r.release_date;
      let title = r.title;

      if (!posterPath || !overview || !releaseDate) {
        const details = await getMovieDetails(tmdbId);
        if (details) {
          posterPath = posterPath || details.poster_path;
          overview = overview || details.overview;
          releaseDate = releaseDate || details.release_date;
          title = title || details.title;
        }
      }
      if (!posterPath || !overview || !title) continue;

      const imdbId = await getImdbId(tmdbId, `movie`);
      finalItems.push({
        id: imdbId || `tmdb_${tmdbId}`,
        imdbId: imdbId || null,
        tmdbId: tmdbId,
        type: `movie`,
        title: title,
        poster: `https://image.tmdb.org/t/p/w500${posterPath}`,
        overview: overview,
        releaseYear: releaseDate ? releaseDate.split(`-`)[0] : `N/A`,
        releaseDate: releaseDate || null
      });
    }

    for (const [tmdbId, r] of seriesById) {
      if (!r.poster_path || !r.overview) continue;
      const imdbId = await getImdbId(tmdbId, `series`);
      finalItems.push({
        id: imdbId || `tmdb_${tmdbId}`,
        imdbId: imdbId || null,
        tmdbId: tmdbId,
        type: `series`,
        title: r.name,
        poster: `https://image.tmdb.org/t/p/w500${r.poster_path}`,
        overview: r.overview,
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
    console.log(`Saved ${finalItems.length} total items to Data/animationsData.js`);
  } catch (err) {
    console.error(`Error updating animations data:`, err.message);
    process.exit(1);
  }
})();
