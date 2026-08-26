require(`dotenv`).config();
const axios = require(`axios`);
const fs = require(`fs`);
const path = require(`path`);

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const BASE_URL = `https://api.themoviedb.org/3`;
const OUTPUT_PATH = path.join(__dirname, `..`, `Data`, `animationsData.js`);
const ANIMATION_GENRE_ID = 16;
const DC_COMPANY_IDS = `9993|184898`;

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

async function fetchAnimatedMovies() {
  const results = [];
  let page = 1, totalPages = 1;
  do {
    const data = await tmdbGet(`/discover/movie`, {
      with_companies: DC_COMPANY_IDS,
      with_genres: ANIMATION_GENRE_ID,
      sort_by: `primary_release_date.asc`,
      "primary_release_date.gte": `1990-01-01`,
      page
    });
    totalPages = data.total_pages;
    for (const r of data.results) {
      if (r.poster_path && r.overview) {
        results.push(await toItem(r, `movie`));
      }
    }
    page++;
  } while (page <= totalPages && page <= 20);
  return results;
}

async function fetchAnimatedSeries() {
  const results = [];
  let page = 1, totalPages = 1;
  do {
    const data = await tmdbGet(`/discover/tv`, {
      with_companies: DC_COMPANY_IDS,
      with_genres: ANIMATION_GENRE_ID,
      sort_by: `first_air_date.asc`,
      "first_air_date.gte": `1990-01-01`,
      page
    });
    totalPages = data.total_pages;
    for (const r of data.results) {
      if (r.poster_path && r.overview) {
        results.push(await toItem(r, `series`));
      }
    }
    page++;
  } while (page <= totalPages && page <= 20);
  return results;
}

(async () => {
  try {
    console.log(`Fetching DC animated movies...`);
    const movies = await fetchAnimatedMovies();
    console.log(`  -> ${movies.length} animated movies found`);

    console.log(`Fetching DC animated series...`);
    const series = await fetchAnimatedSeries();
    console.log(`  -> ${series.length} animated series found`);

    const combined = [...movies, ...series].sort((a, b) => {
      if (!a.releaseDate) return 1;
      if (!b.releaseDate) return -1;
      return new Date(a.releaseDate) - new Date(b.releaseDate);
    });

    const fileContent = `module.exports = ${JSON.stringify(combined, null, 2)};\n`;
    fs.writeFileSync(OUTPUT_PATH, fileContent, `utf8`);
    console.log(`Saved ${combined.length} total items to Data/animationsData.js`);
  } catch (err) {
    console.error(`Error updating animations data:`, err.message);
    process.exit(1);
  }
})();
