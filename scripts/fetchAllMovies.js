require(`dotenv`).config();
const axios = require(`axios`);
const fs = require(`fs`);
const path = require(`path`);

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const BASE_URL = `https://api.themoviedb.org/3`;
const OUTPUT_PATH = path.join(__dirname, `..`, `Data`, `moviesData.js`);
const DC_COMPANY_IDS = `9993|184898|128064`;
const SUPPLEMENTARY_LIST_IDS = [3, 94805, 105614];

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
    const data = await tmdbGet(`/movie/${tmdbId}/external_ids`);
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

async function fetchDiscoveredMovies() {
  const results = [];
  let page = 1, totalPages = 1;
  do {
    const data = await tmdbGet(`/discover/movie`, {
      with_companies: DC_COMPANY_IDS,
      without_genres: 16,
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

async function fetchListMovies(listId) {
  try {
    const data = await tmdbGet(`/list/${listId}`);
    const items = (data.items || []).filter(i => !i.media_type || i.media_type === `movie`);
    return items;
  } catch (err) {
    console.warn(`Could not fetch list ${listId}: ${err.message}`);
    return [];
  }
}

(async () => {
  try {
    console.log(`Discovering DC movies by production company...`);
    const companyResults = await fetchDiscoveredMovies();
    console.log(`  -> ${companyResults.length} candidates from company discovery`);

    let listResults = [];
    for (const listId of SUPPLEMENTARY_LIST_IDS) {
      console.log(`Fetching supplementary list ${listId}...`);
      const items = await fetchListMovies(listId);
      console.log(`  -> ${items.length} items from list ${listId}`);
      listResults.push(...items);
    }

    const byId = new Map();
    for (const r of [...companyResults, ...listResults]) {
      if (!r.id) continue;
      if (!byId.has(r.id)) byId.set(r.id, r);
    }
    console.log(`Total unique candidates after merge: ${byId.size}`);

    const finalItems = [];
    for (const [tmdbId, r] of byId) {
      let posterPath = r.poster_path;
      let overview = r.overview;
      let releaseDate = r.release_date;
      let title = r.title;
      let genreIds = r.genre_ids || [];

      if (!posterPath || !overview || !releaseDate) {
        const details = await getMovieDetails(tmdbId);
        if (details) {
          posterPath = posterPath || details.poster_path;
          overview = overview || details.overview;
          releaseDate = releaseDate || details.release_date;
          title = title || details.title;
          genreIds = genreIds.length ? genreIds : (details.genres || []).map(g => g.id);
        }
      }

      if (!posterPath || !overview || !title) continue;
      if (genreIds.includes(16)) continue;

      const imdbId = await getImdbId(tmdbId);
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

    finalItems.sort((a, b) => {
      if (!a.releaseDate) return 1;
      if (!b.releaseDate) return -1;
      return new Date(a.releaseDate) - new Date(b.releaseDate);
    });

    const fileContent = `module.exports = ${JSON.stringify(finalItems, null, 2)};\n`;
    fs.writeFileSync(OUTPUT_PATH, fileContent, `utf8`);
    console.log(`Saved ${finalItems.length} total movies to Data/moviesData.js`);
  } catch (err) {
    console.error(`Error updating movies data:`, err.message);
    process.exit(1);
  }
})();
