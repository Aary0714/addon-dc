require(`dotenv`).config();
const axios = require(`axios`);
const fs = require(`fs`);
const path = require(`path`);

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const BASE_URL = `https://api.themoviedb.org/3`;
const OUTPUT_PATH = path.join(__dirname, `..`, `Data`, `dcau.json`);

if (!TMDB_API_KEY) {
  console.error(`Missing TMDB_API_KEY in environment.`);
  process.exit(1);
}

const DCAU_TV_TITLES = [
  `Batman: The Animated Series`,
  `Superman: The Animated Series`,
  `The New Batman Adventures`,
  `Batman Beyond`,
  `Static Shock`,
  `Justice League`,
  `Justice League Unlimited`
];

const DCAU_MOVIE_TITLES = [
  `Batman: Mask of the Phantasm`,
  `Batman & Mr. Freeze: SubZero`,
  `Batman Beyond: Return of the Joker`,
  `Batman: Mystery of the Batwoman`
];

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

async function searchExact(endpoint, title) {
  const data = await tmdbGet(endpoint, { query: title });
  if (!data.results || data.results.length === 0) return null;
  const exact = data.results.find(r =>
    (r.title || r.name || ``).toLowerCase() === title.toLowerCase()
  );
  return exact || data.results[0];
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

(async () => {
  try {
    const results = [];

    for (const title of DCAU_TV_TITLES) {
      const match = await searchExact(`/search/tv`, title);
      if (match) results.push(await toItem(match, `series`));
    }
    for (const title of DCAU_MOVIE_TITLES) {
      const match = await searchExact(`/search/movie`, title);
      if (match) results.push(await toItem(match, `movie`));
    }

    results.sort((a, b) => {
      if (!a.releaseDate) return 1;
      if (!b.releaseDate) return -1;
      return new Date(a.releaseDate) - new Date(b.releaseDate);
    });

    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2));
    console.log(`Saved ${results.length} DCAU items to Data/dcau.json`);
  } catch (err) {
    console.error(`Error updating DCAU data:`, err.message);
    process.exit(1);
  }
})();
