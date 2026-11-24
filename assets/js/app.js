/* Soricia — rendering, in-page manager, filters and local persistence. */
(function () {
  "use strict";

  const SEED = JSON.parse(JSON.stringify(window.SITE_DATA || { profile: {}, songs: [], anime: [] }));
  const SEED_VERSION = SEED.version || "seed";
  let currentVersion = SEED_VERSION;
  const STORAGE_KEY = "soricia.collection.v1";
  const VERSION_KEY = "soricia.collection.version";
  const BACKUP_KEY = "soricia.collection.backup.v1";

  const CONFIG = window.SITE_CONFIG || {};
  const FIREBASE_URL = String(CONFIG.firebaseUrl || "").replace(/\/+$/, "");
  const VOTES_PATH = String(CONFIG.votesPath || "votes").replace(/^\/+|\/+$/g, "");
  const VOTES_ENABLED = !!FIREBASE_URL;
  const VOTER_KEY = "soricia.voter.token";
  const MY_VOTES_KEY = "soricia.my.votes";
  const OWNER_KEY = "soricia.owner.mode";
  const OWNER_MODE = initOwnerMode();
  let ratings = {};
  let ratingsStatus = VOTES_ENABLED ? "loading" : "off";
  let myVotes = loadMyVotes();
  const voteDrafts = {};

  const $ = (selector) => document.querySelector(selector);
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const uid = (prefix) => prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[ch]);
  const fold = (value) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const fmt = (score) => Number(score || 0).toFixed(1);

  // Ảnh bìa có sẵn trong data/data.js — không cần nhét lại vào localStorage (dễ vượt hạn mức ~5MB).
  const SEED_SENTINEL = "__from_data_js__";
  const itemKey = (item, type) => fold(item.title) + "|" + fold(type === "song" ? item.artist : item.alt);
  const seedImageMaps = { song: new Map(), anime: new Map() };
  (SEED.songs || []).forEach((item) => { if (item.image) seedImageMaps.song.set(itemKey(item, "song"), item.image); });
  (SEED.anime || []).forEach((item) => { if (item.image) seedImageMaps.anime.set(itemKey(item, "anime"), item.image); });
  const seedImageSets = {
    song: new Set(seedImageMaps.song.values()),
    anime: new Set(seedImageMaps.anime.values())
  };
  const compactItem = (item, type) =>
    item.image && seedImageSets[type] && seedImageSets[type].has(item.image)
      ? { ...item, image: SEED_SENTINEL, seedKey: itemKey(item, type) }
      : item;
  const expandItem = (item, type) => {
    if (item.image !== SEED_SENTINEL) return item;
    const { seedKey, ...rest } = item;
    return { ...rest, image: seedImageMaps[type].get(seedKey || itemKey(item, type)) || null };
  };
  const compactCollection = (data) => ({
    songs: (data && data.songs ? data.songs : []).map((x) => compactItem(x, "song")),
    anime: (data && data.anime ? data.anime : []).map((x) => compactItem(x, "anime"))
  });
  const expandCollection = (data) => ({
    songs: (data && data.songs ? data.songs : []).map((x) => expandItem(x, "song")),
    anime: (data && data.anime ? data.anime : []).map((x) => expandItem(x, "anime"))
  });
  const clampScore = (value) => Math.min(10, Math.max(0, Number(value) || 0));
  function youtubeId(value) {
    const text = String(value ?? "").trim();
    if (/^[\w-]{11}$/.test(text)) return text;
    const match = text.match(/(?:v=|youtu\.be\/|youtube\.com\/(?:embed\/|shorts\/|live\/|watch\/))([\w-]{11})/i);
    return match ? match[1] : null;
  }
  const seedYoutube = new Map();
  (SEED.songs || []).forEach((item) => {
    const id = youtubeId(item.youtube);
    if (id) seedYoutube.set(itemKey(item, "song"), id);
  });

  const palettes = [
    ["#6d5dfc", "#1f9c8a"], ["#e0567a", "#7d4bcf"], ["#f0a13c", "#b8465f"],
    ["#2f80ed", "#56ccb0"], ["#8f5bd7", "#ef6b8c"], ["#0e8f7e", "#3d6bd6"],
    ["#c65f3c", "#e9a03a"], ["#4f6bd8", "#9b59b6"]
  ];
  const paletteFor = (text) => {
    let hash = 0;
    for (const ch of String(text)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    return palettes[hash % palettes.length];
  };
  const initialsFor = (title) => String(title).split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

  function normalize(list, prefix) {
    return (Array.isArray(list) ? list : []).map((item, i) => {
      const clean = { ...item };
      clean.id = clean.id || uid(prefix);
      clean.index = i;
      clean.rank = Number(clean.rank) || i + 1;
      clean.score = clampScore(clean.score);
      if (!clean.genre) clean.genre = "Khác";
      if (clean.image && !/^(data:image\/|https?:\/\/)/i.test(clean.image)) clean.image = null;
      clean.youtube = youtubeId(clean.youtube) || null;
      return clean;
    });
  }

  function seedCollection() {
    return { songs: normalize(SEED.songs, "song"), anime: normalize(SEED.anime, "anime") };
  }

  function loadCollection() {
    try {
      const storedVersion = localStorage.getItem(VERSION_KEY);
      const raw = localStorage.getItem(STORAGE_KEY);
      // Old saved data may hold every cover as base64 — shrink it before anything else.
      const oldBackup = localStorage.getItem(BACKUP_KEY);
      if (oldBackup) {
        try {
          const smaller = JSON.stringify(compactCollection(JSON.parse(oldBackup)));
          if (smaller.length < oldBackup.length) localStorage.setItem(BACKUP_KEY, smaller);
        } catch (e) { /* ignore corrupt backup */ }
      }
      if (storedVersion !== currentVersion) {
        // A newer data.js arrived (e.g. synced from Google Drive): the repo wins.
        if (raw) {
          try { localStorage.setItem(BACKUP_KEY, JSON.stringify(compactCollection(JSON.parse(raw)))); }
          catch (e) { /* ignore corrupt data */ }
        }
        localStorage.setItem(VERSION_KEY, currentVersion);
        const fresh = seedCollection();
        // Persist the new seed now — otherwise the next visit re-reads the stale collection.
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(compactCollection(fresh))); }
        catch (e) { /* storage may be full; seed still renders this visit */ }
        return fresh;
      }
      if (raw) {
        const parsed = expandCollection(JSON.parse(raw));
        if (Array.isArray(parsed.songs) || Array.isArray(parsed.anime)) {
          const songs = normalize(parsed.songs, "song");
          songs.forEach((song) => {
            if (!song.youtube) {
              const id = seedYoutube.get(itemKey(song, "song"));
              if (id) song.youtube = id;
            }
          });
          return { songs, anime: normalize(parsed.anime, "anime") };
        }
      }
    } catch (e) { /* ignore unavailable or corrupt storage */ }
    return seedCollection();
  }

  const loaded = loadCollection();
  let songs = loaded.songs;
  let anime = loaded.anime;

  const state = {
    songGenre: "Tất cả", songQuery: "", songSort: "score",
    animeGenre: "Tất cả", animeQuery: "", animeSort: "score"
  };
  const pendingImages = { song: null, anime: null };
  let lastFocused = null;

  function initOwnerMode() {
    const params = new URLSearchParams(window.location.search);
    if (params.has("admin")) {
      try {
        if (params.get("admin") === "0") localStorage.removeItem(OWNER_KEY);
        else localStorage.setItem(OWNER_KEY, "1");
      } catch (e) { /* ignore */ }
    }
    let enabled = false;
    try { enabled = localStorage.getItem(OWNER_KEY) === "1"; } catch (e) { /* ignore */ }
    document.body.classList.toggle("owner-mode", enabled);
    return enabled;
  }

  function songKey(song) {
    return fold(song.title).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "song-" + (song.index || 0);
  }

  function loadMyVotes() {
    try { return JSON.parse(localStorage.getItem(MY_VOTES_KEY) || "{}") || {}; }
    catch (e) { return {}; }
  }

  function persistMyVotes() {
    try { localStorage.setItem(MY_VOTES_KEY, JSON.stringify(myVotes)); } catch (e) { /* ignore */ }
  }

  function voterToken() {
    let token = null;
    try { token = localStorage.getItem(VOTER_KEY); } catch (e) { /* ignore */ }
    if (!token) {
      token = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : "v-" + Date.now() + "-" + Math.random().toString(36).slice(2);
      try { localStorage.setItem(VOTER_KEY, token); } catch (e) { /* ignore */ }
    }
    return token;
  }

  function firebaseUrl(path) {
    return FIREBASE_URL + "/" + String(path || "").replace(/^\/+/, "") + ".json";
  }

  async function loadRatings() {
    if (!VOTES_ENABLED) return;
    ratingsStatus = "loading";
    try {
      const res = await fetch(firebaseUrl(VOTES_PATH));
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      const next = {};
      Object.entries(data && typeof data === "object" ? data : {}).forEach(([songId, votes]) => {
        const scores = Object.values(votes && typeof votes === "object" ? votes : {})
          .map(Number)
          .filter((n) => n >= 1 && n <= 10);
        if (!scores.length) return;
        next[songId] = {
          avg: scores.reduce((a, b) => a + b, 0) / scores.length,
          count: scores.length
        };
      });
      const unchanged = ratingsStatus !== "error" && JSON.stringify(next) === JSON.stringify(ratings);
      ratings = next;
      ratingsStatus = "ready";
      if (unchanged) return; // don't wipe what a visitor is typing
    } catch (e) {
      ratingsStatus = "error";
      console.warn("Không tải được điểm bình chọn:", e);
    }
    renderSongs();
  }

  async function submitVote(songId, score) {
    if (!VOTES_ENABLED) return;
    const changing = myVotes[songId] != null;
    try {
      const res = await fetch(firebaseUrl(VOTES_PATH + "/" + encodeURIComponent(songId) + "/" + encodeURIComponent(voterToken())), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(score)
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      myVotes[songId] = score;
      persistMyVotes();
      delete voteDrafts[songId];
      toast(changing ? "Đã cập nhật điểm của bạn." : "Đã ghi điểm của bạn. Cảm ơn!");
      await loadRatings();
      renderSongs();
    } catch (e) {
      toast("Không gửi được điểm. Thử lại sau.");
    }
  }

  function scoreBlock(song) {
    const key = songKey(song);
    if (!VOTES_ENABLED) {
      return `<div class="song-score"><strong>${fmt(song.score)}</strong><small>điểm của tác giả</small><span class="vote-note">Bình chọn chưa được bật.</span></div>`;
    }
    const rating = ratings[key];
    const avg = rating && rating.count ? fmt(rating.avg) : "—";
    const countText = rating && rating.count ? rating.count + " lượt chấm" : "chưa có lượt chấm";
    const existing = myVotes[key];
    const status = ratingsStatus === "error" ? `<span class="vote-note">Chưa tải được điểm cộng đồng.</span>` : "";
    return `
      <div class="song-score">
        <strong>${avg}</strong>
        <small>điểm trung bình · ${countText}</small>
        <div class="author-score">Điểm của tác giả: <b>${fmt(song.score)}</b></div>
        <form class="vote-form" data-song="${esc(key)}">
          <label class="sr-only" for="vote-${esc(key)}">Điểm của bạn cho bài ${esc(song.title)}</label>
          <input id="vote-${esc(key)}" type="text" inputmode="decimal" autocomplete="off" spellcheck="false"
                 placeholder="1–10" value="${esc(voteDrafts[key] ?? (existing != null ? existing : ""))}">
          <button type="submit">${existing != null ? "Sửa" : "Gửi"}</button>
        </form>
        ${existing != null ? `<span class="my-vote">Bạn đã chấm: ${esc(existing)} — có thể đổi</span>` : ""}
        ${status}
      </div>
    `;
  }

  const toPublic = (item) => {
    const { id, index, ...rest } = item;
    return rest;
  };

  function save() {
    const json = JSON.stringify(compactCollection({
      songs: songs.map(toPublic), anime: anime.map(toPublic)
    }));
    try {
      localStorage.setItem(STORAGE_KEY, json);
      localStorage.setItem(VERSION_KEY, currentVersion);
      return true;
    } catch (e) {
      // A stale backup from an older version can alone fill the quota.
      try {
        localStorage.removeItem(BACKUP_KEY);
        localStorage.setItem(STORAGE_KEY, json);
        localStorage.setItem(VERSION_KEY, currentVersion);
        toast("Đã lưu (đã dọn bản sao cũ trong trình duyệt để đủ chỗ).");
        return true;
      } catch (e2) { /* genuinely full or storage disabled */ }
      toast("Không lưu được: bộ nhớ trình duyệt đầy. Hãy tải file JSON rồi xoá bớt ảnh bạn tự thêm.");
      return false;
    }
  }

  function toast(message) {
    const el = $("#toast");
    el.textContent = message;
    el.classList.add("is-visible");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove("is-visible"), 2800);
  }

  function setPlayerSize(expanded) {
    const modal = $("#player-modal");
    modal.classList.toggle("is-expanded", expanded);
    modal.classList.toggle("is-mini", !expanded);
    modal.querySelector(".player-backdrop").hidden = !expanded;
    $("#player-expand").textContent = expanded ? "🗕" : "⤢";
    $("#player-expand").setAttribute("aria-label", expanded ? "Thu nhỏ trình phát" : "Phóng to trình phát");
    document.body.classList.toggle("player-expanded", expanded);
  }

  function openPlayer(id, title) {
    const video = youtubeId(id);
    if (!video) return;
    $("#player-frame").innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(video)}?autoplay=1&rel=0" title="Nghe bài hát" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
    $("#player-title").textContent = title || "Đang nghe";
    setPlayerSize(false);
    $("#player-modal").hidden = false;
  }

  function closePlayer() {
    $("#player-modal").hidden = true;
    $("#player-frame").innerHTML = "";
    document.body.classList.remove("player-expanded");
  }

  function sortItems(items, mode) {
    const copy = [...items];
    if (mode === "rank") return copy.sort((a, b) => a.rank - b.rank);
    if (mode === "community") {
      const avg = (song) => ratings[songKey(song)] ? ratings[songKey(song)].avg : -1;
      return copy.sort((a, b) => avg(b) - avg(a) || a.index - b.index);
    }
    if (mode === "title") return copy.sort((a, b) => String(a.title).localeCompare(String(b.title), "vi"));
    if (mode === "year") return copy.sort((a, b) => (b.year || 0) - (a.year || 0));
    return copy.sort((a, b) => (b.score || 0) - (a.score || 0) || a.index - b.index);
  }

  function filterItems(items, genre, query) {
    const q = fold(query).trim();
    return items.filter((item) => {
      if (genre !== "Tất cả" && item.genre !== genre) return false;
      if (!q) return true;
      return fold([item.title, item.artist, item.genre, item.alt, item.note].filter(Boolean).join(" ")).includes(q);
    });
  }

  const uniqueGenres = (items) => [...new Set(items.map((item) => item.genre).filter(Boolean))]
    .sort((a, b) => String(a).localeCompare(String(b), "vi"));

  function makeChips(container, genres, active, onSelect) {
    container.innerHTML = ["Tất cả", ...genres].map((genre) => `
      <button type="button" class="chip" data-genre="${esc(genre)}" aria-pressed="${genre === active}">${esc(genre)}</button>
    `).join("");
    container.querySelectorAll(".chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        container.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", "false"));
        chip.setAttribute("aria-pressed", "true");
        onSelect(chip.dataset.genre);
      });
    });
  }

  function actionsFor(type, item) {
    if (!OWNER_MODE) return "";
    return `
      <div class="item-actions">
        <button type="button" data-action="edit" data-type="${type}" data-id="${esc(item.id)}" aria-label="Sửa ${esc(item.title)}">✎ Sửa</button>
        <button type="button" class="is-danger" data-action="delete" data-type="${type}" data-id="${esc(item.id)}" aria-label="Xoá ${esc(item.title)}">✕ Xoá</button>
      </div>
    `;
  }

  function renderSongs() {
    const items = sortItems(filterItems(songs, state.songGenre, state.songQuery), state.songSort);
    const topScore = songs.length ? Math.max(...songs.map((s) => s.score || 0)) : 0;
    $("#music-list").innerHTML = items.map((song, i) => `
      <li class="song${(song.score || 0) >= topScore - 0.05 ? " is-top" : ""}">
        <span class="song-rank${song.image ? " has-image" : ""}" aria-label="Vị trí ${i + 1}">
          ${song.image ? `<img src="${esc(song.image)}" alt="">` : ""}
          <b>${String(i + 1).padStart(2, "0")}</b>
        </span>
        <div class="song-main">
          <div class="song-title-line">
            <h3 class="song-title">${esc(song.title)}</h3>
            <span class="song-artist">${esc(song.artist)}</span>
          </div>
          ${song.note ? `<p class="song-note">${esc(song.note)}</p>` : ""}
          <div class="song-meta">
            <span class="genre-badge">${esc(song.genre)}</span>
            ${song.year ? `<span>${esc(song.year)}</span>` : ""}
            <span class="meter" title="Điểm ${fmt(song.score)}/10"><span style="width:${Math.min(100, Math.max(0, song.score * 10))}%"></span></span>
          </div>
          ${actionsFor("song", song)}
          <div class="listen-row">
            ${song.youtube
              ? `<button type="button" class="listen-btn" data-play="${esc(song.youtube)}" data-title="${esc(song.title)}" aria-label="Nghe ${esc(song.title)}">▶ Nghe</button>
                 <a class="listen-link" href="https://www.youtube.com/watch?v=${esc(song.youtube)}" target="_blank" rel="noopener noreferrer">Mở YouTube ↗</a>`
              : `<a class="listen-btn" href="https://www.youtube.com/results?search_query=${encodeURIComponent(song.title + " " + (song.artist || ""))}" target="_blank" rel="noopener noreferrer">🔎 Tìm bài trên YouTube</a>`}
          </div>
        </div>
        ${scoreBlock(song)}
      </li>
    `).join("");

    $("#music-count").textContent = String(items.length);
    const empty = $("#music-empty");
    empty.hidden = items.length > 0;
    empty.textContent = songs.length === 0
      ? "Chưa có bài hát nào. Bấm “+ Thêm bài hát” để bắt đầu nhé."
      : "Không tìm thấy bài hát phù hợp. Thử đổi từ khoá hoặc thể loại nhé.";
  }

  function renderAnime() {
    const items = sortItems(filterItems(anime, state.animeGenre, state.animeQuery), state.animeSort);
    $("#anime-list").innerHTML = items.map((show, i) => {
      const [from, to] = paletteFor(show.title);
      const stars = Math.round((show.score || 0) / 2);
      const watching = fold(show.status).includes("dang");
      return `
        <article class="anime-card">
          <div class="anime-cover" style="--c1:${from};--c2:${to}">
            ${show.image ? `<img class="anime-cover-img" src="${esc(show.image)}" alt="">` : ""}
            <span class="status-tag${watching ? " is-watching" : ""}">${esc(show.status || "Đã xem")}</span>
            <span class="anime-cover-rank">#${String(i + 1).padStart(2, "0")}</span>
            <span class="anime-initials">${esc(initialsFor(show.title))}</span>
          </div>
          <div class="anime-body">
            <h3 class="anime-title">${esc(show.title)}</h3>
            ${show.alt ? `<p class="anime-sub">${esc(show.alt)}</p>` : ""}
            <p class="anime-sub">${esc(show.genre)} · ${show.year ? esc(show.year) + " · " : ""}${show.episodes ? esc(show.episodes) + " tập" : ""}</p>
            ${show.note ? `<p class="anime-note">${esc(show.note)}</p>` : ""}
            ${actionsFor("anime", show)}
            <div class="anime-foot">
              <span class="stars" aria-label="${stars}/5 sao">${"★".repeat(stars)}${"☆".repeat(5 - stars)}</span>
              <span class="anime-score">${fmt(show.score)} <small>/ 10</small></span>
            </div>
          </div>
        </article>
      `;
    }).join("");

    $("#anime-count").textContent = String(items.length);
    const empty = $("#anime-empty");
    empty.hidden = items.length > 0;
    empty.textContent = anime.length === 0
      ? "Chưa có anime nào. Bấm “+ Thêm anime” để thêm tựa đầu tiên."
      : "Chưa có anime nào khớp với bộ lọc này.";
  }

  function fillHeroAndStats() {
    const bestSong = [...songs].sort((a, b) => (b.score || 0) - (a.score || 0))[0];
    const bestAnime = [...anime].sort((a, b) => (b.score || 0) - (a.score || 0))[0];
    if (bestSong) {
      $("#hero-song-title").textContent = bestSong.title;
      $("#hero-song-artist").textContent = bestSong.artist || "";
      $("#hero-song-genre").textContent = bestSong.genre || "";
      $("#hero-song-score").textContent = fmt(bestSong.score);
    } else {
      $("#hero-song-title").textContent = "Chưa có bài hát";
      $("#hero-song-artist").textContent = "Danh sách đang chờ cập nhật";
      $("#hero-song-genre").textContent = "Sắp thêm";
      $("#hero-song-score").textContent = "—";
    }
    if (bestAnime) {
      $("#hero-anime-title").textContent = bestAnime.title;
      $("#hero-anime-meta").textContent = [bestAnime.year, bestAnime.episodes ? bestAnime.episodes + " tập" : null].filter(Boolean).join(" · ");
      $("#hero-anime-genre").textContent = bestAnime.genre || "";
      $("#hero-anime-score").textContent = fmt(bestAnime.score);
    } else {
      $("#hero-anime-title").textContent = "Chưa có anime";
      $("#hero-anime-meta").textContent = "Danh sách đang chờ cập nhật";
      $("#hero-anime-genre").textContent = "Sắp thêm";
      $("#hero-anime-score").textContent = "—";
    }
    const allScores = [...songs, ...anime].map((item) => Number(item.score) || 0);
    const avg = allScores.length ? allScores.reduce((a, b) => a + b, 0) / allScores.length : 0;
    document.querySelector('[data-stat="songs"]').textContent = songs.length;
    document.querySelector('[data-stat="genres"]').textContent = new Set([...songs, ...anime].map((x) => x.genre).filter(Boolean)).size;
    document.querySelector('[data-stat="anime"]').textContent = anime.length;
    document.querySelector('[data-stat="avg"]').textContent = allScores.length ? fmt(avg) : "—";
  }

  function renderAll() {
    if (state.songGenre !== "Tất cả" && !uniqueGenres(songs).includes(state.songGenre)) state.songGenre = "Tất cả";
    if (state.animeGenre !== "Tất cả" && !uniqueGenres(anime).includes(state.animeGenre)) state.animeGenre = "Tất cả";
    renderSongs();
    renderAnime();
    fillHeroAndStats();
    const genres = uniqueGenres([...songs, ...anime]);
    $("#genre-options").innerHTML = genres.map((g) => `<option value="${esc(g)}"></option>`).join("");
    makeChips($("#music-filters"), uniqueGenres(songs), state.songGenre, (g) => { state.songGenre = g; renderSongs(); });
    makeChips($("#anime-filters"), uniqueGenres(anime), state.animeGenre, (g) => { state.animeGenre = g; renderAnime(); });
  }

  /* ---------- image handling ---------- */
  function readImage(file) {
    return new Promise((resolve, reject) => {
      if (!file || !file.type.startsWith("image/")) return reject(new Error("not an image"));
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("read failed"));
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const max = 520;
          const scale = Math.min(1, max / Math.max(img.width, img.height));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/jpeg", 0.82));
        };
        img.onerror = () => resolve(reader.result);
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function updateImagePreview(type) {
    const img = $("#" + type + "-image-preview");
    const placeholder = $("#" + type + "-image-placeholder");
    const remove = $("#" + type + "-remove-image");
    const value = pendingImages[type];
    if (value) {
      img.src = value; img.hidden = false;
      placeholder.hidden = true; remove.hidden = false;
    } else {
      img.removeAttribute("src"); img.hidden = true;
      placeholder.hidden = false; remove.hidden = true;
    }
  }

  /* ---------- manager panel ---------- */
  function setTab(tab) {
    document.querySelectorAll(".panel-tab").forEach((btn) => {
      const active = btn.dataset.tab === tab;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-selected", String(active));
    });
    $("#song-form").hidden = tab !== "song";
    $("#anime-form").hidden = tab !== "anime";
    $("#data-tools").hidden = tab !== "data";
  }

  function resetForm(type) {
    $("#" + type + "-form").reset();
    $("#" + type + "-edit-id").value = "";
    $("#" + type + "-score").value = "8";
    $("#" + type + "-submit").textContent = type === "song" ? "Thêm bài hát" : "Thêm anime";
    pendingImages[type] = null;
    updateImagePreview(type);
  }

  function openEditor(type, id) {
    const list = type === "song" ? songs : anime;
    const item = id ? list.find((x) => x.id === id) : null;
    setTab(type);
    resetForm(type);
    if (!item) return;
    const fields = type === "song"
      ? { title: "song-title", artist: "song-artist", genre: "song-genre", score: "song-score", year: "song-year", note: "song-note", youtube: "song-youtube" }
      : { title: "anime-title", alt: "anime-alt", genre: "anime-genre", score: "anime-score", year: "anime-year", episodes: "anime-episodes", status: "anime-status", note: "anime-note" };
    Object.entries(fields).forEach(([key, inputId]) => {
      const el = $("#" + inputId);
      if (el) el.value = item[key] ?? "";
    });
    $("#" + type + "-edit-id").value = item.id;
    $("#" + type + "-submit").textContent = "Lưu thay đổi";
    pendingImages[type] = item.image || null;
    updateImagePreview(type);
  }

  function openPanel(tab, id) {
    if (!OWNER_MODE) return;
    lastFocused = document.activeElement;
    $("#panel-backdrop").hidden = false;
    document.body.classList.add("panel-open");
    $("#admin-panel").setAttribute("aria-hidden", "false");
    if (id) openEditor(tab, id);
    else { setTab(tab); resetForm(tab); }
    setTimeout(() => {
      const first = $("#admin-panel").querySelector(".editor-form:not([hidden]) input:not([type=hidden])");
      if (first) first.focus();
    }, 300);
  }

  function closePanel() {
    document.body.classList.remove("panel-open");
    $("#admin-panel").setAttribute("aria-hidden", "true");
    $("#panel-backdrop").hidden = true;
    if (lastFocused && lastFocused.focus) lastFocused.focus();
  }

  function submitForm(type) {
    const list = type === "song" ? songs : anime;
    const title = $("#" + type + "-title").value.trim();
    const genre = $("#" + type + "-genre").value.trim();
    if (!title || !genre) { toast("Nhớ nhập tên và thể loại nhé."); return; }
    const editingId = $("#" + type + "-edit-id").value;
    const pos = list.findIndex((x) => x.id === editingId);
    const old = pos >= 0 ? list[pos] : null;
    const numberOrNull = (id) => {
      const raw = $("#" + id).value.trim();
      return raw === "" ? null : Number(raw);
    };
    const item = {
      id: old ? old.id : uid(type),
      index: old ? old.index : list.length,
      rank: old ? old.rank : list.length + 1,
      title,
      genre,
      score: clampScore($("#" + type + "-score").value),
      year: numberOrNull(type + "-year"),
      note: $("#" + type + "-note").value.trim() || null,
      image: pendingImages[type] || null
    };
    if (type === "song") {
      item.artist = $("#song-artist").value.trim() || "Không rõ";
      item.youtube = youtubeId($("#song-youtube").value);
    } else {
      item.alt = $("#anime-alt").value.trim() || null;
      item.episodes = numberOrNull("anime-episodes");
      item.status = $("#anime-status").value;
    }
    if (pos >= 0) list[pos] = item;
    else list.push(item);
    if (save()) {
      renderAll();
      resetForm(type);
      toast(pos >= 0 ? "Đã lưu thay đổi." : "Đã thêm vào danh sách.");
    }
  }

  function deleteItem(type, id) {
    const list = type === "song" ? songs : anime;
    const item = list.find((x) => x.id === id);
    if (!item || !window.confirm('Xoá "' + item.title + '" khỏi danh sách?')) return;
    const next = list.filter((x) => x.id !== id).map((x, i) => ({ ...x, index: i }));
    if (type === "song") songs = next;
    else anime = next;
    save();
    renderAll();
    toast("Đã xoá khỏi danh sách.");
  }

  function downloadFile(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function initManager() {
    $("#manage-btn").addEventListener("click", () => openPanel("song"));
    $("#panel-close").addEventListener("click", closePanel);
    $("#panel-backdrop").addEventListener("click", closePanel);
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (!$("#player-modal").hidden) {
        if ($("#player-modal").classList.contains("is-expanded")) setPlayerSize(false);
        else closePlayer();
      } else if (document.body.classList.contains("panel-open")) closePanel();
    });
    document.querySelectorAll(".panel-tab").forEach((btn) => {
      btn.addEventListener("click", () => setTab(btn.dataset.tab));
    });

    document.addEventListener("click", (e) => {
      if (e.target.closest("[data-close-player]")) { closePlayer(); return; }
      if (e.target.closest("[data-toggle-player]")) {
        setPlayerSize(!$("#player-modal").classList.contains("is-expanded"));
        return;
      }
      const play = e.target.closest("[data-play]");
      if (play) { openPlayer(play.dataset.play, play.dataset.title); return; }
      const opener = e.target.closest("[data-open-editor]");
      if (opener) { openPanel(opener.dataset.openEditor); return; }
      const button = e.target.closest("button[data-action]");
      if (!button) return;
      if (button.dataset.action === "vote") { submitVote(button.dataset.id, Number(button.dataset.score)); return; }
      if (button.dataset.action === "edit") openPanel(button.dataset.type, button.dataset.id);
      if (button.dataset.action === "delete") deleteItem(button.dataset.type, button.dataset.id);
    });

    document.addEventListener("input", (e) => {
      if (!e.target.matches(".vote-form input")) return;
      const form = e.target.closest("form.vote-form");
      voteDrafts[form.dataset.song] = e.target.value;
    });

    document.addEventListener("submit", (e) => {
      const form = e.target.closest("form.vote-form");
      if (!form) return;
      e.preventDefault();
      const input = form.querySelector("input");
      const raw = String(input.value).trim().replace(",", ".");
      const score = Number(raw);
      if (raw === "" || !Number.isFinite(score) || score < 1 || score > 10) {
        toast("Nhập điểm từ 1 đến 10 nhé.");
        input.focus();
        return;
      }
      submitVote(form.dataset.song, score);
    });

    ["song", "anime"].forEach((type) => {
      $("#" + type + "-form").addEventListener("submit", (e) => { e.preventDefault(); submitForm(type); });
      $("#" + type + "-image").addEventListener("change", async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try { pendingImages[type] = await readImage(file); updateImagePreview(type); }
        catch (err) { toast("Không đọc được ảnh. Thử file khác nhé."); }
      });
      $("#" + type + "-remove-image").addEventListener("click", () => {
        pendingImages[type] = null;
        $("#" + type + "-image").value = "";
        updateImagePreview(type);
      });
    });

    $("#export-json").addEventListener("click", () => {
      const payload = {
        version: currentVersion,
        profile: SEED.profile || {},
        songs: songs.map(toPublic),
        anime: anime.map(toPublic)
      };
      downloadFile(JSON.stringify(payload, null, 2), "soricia-data.json", "application/json");
      toast("Đã tải file JSON.");
    });

    $("#export-js").addEventListener("click", () => {
      const payload = {
        version: currentVersion,
        profile: SEED.profile || {},
        songs: songs.map(toPublic),
        anime: anime.map(toPublic)
      };
      const code = "/** Dữ liệu xuất từ trang web Soricia. Thay nội dung data/data.js bằng file này. */\nwindow.SITE_DATA = " + JSON.stringify(payload, null, 2) + ";\n";
      downloadFile(code, "data.js", "text/javascript");
      toast("Đã tải data.js.");
    });

    $("#import-json").addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result);
          currentVersion = parsed.version || new Date().toISOString();
          songs = normalize(parsed.songs, "song");
          anime = normalize(parsed.anime, "anime");
          save(); renderAll();
          toast("Đã nhập dữ liệu thành công.");
        } catch (err) {
          toast("File JSON không hợp lệ.");
        }
        e.target.value = "";
      };
      reader.readAsText(file);
    });

    $("#restore-backup").addEventListener("click", () => {
      let backup = null;
      try { backup = localStorage.getItem(BACKUP_KEY); } catch (e) { /* ignore */ }
      if (!backup || !window.confirm("Khôi phục bản đã lưu trước đó trong trình duyệt?")) {
        if (!backup) toast("Không có bản sao lưu trong trình duyệt này.");
        return;
      }
      try {
        const parsed = expandCollection(JSON.parse(backup));
        songs = normalize(parsed.songs, "song");
        anime = normalize(parsed.anime, "anime");
        save(); renderAll();
        toast("Đã khôi phục bản sao lưu.");
      } catch (e) {
        toast("Bản sao lưu không hợp lệ.");
      }
    });

    $("#reset-data").addEventListener("click", () => {
      if (!window.confirm("Khôi phục dữ liệu gốc từ data.js? Mọi thay đổi trong trình duyệt sẽ mất.")) return;
      currentVersion = SEED_VERSION;
      songs = normalize(SEED.songs, "song");
      anime = normalize(SEED.anime, "anime");
      save(); renderAll();
      toast("Đã khôi phục dữ liệu gốc.");
    });
  }

  function initTheme() {
    const root = document.documentElement;
    let saved = null;
    try { saved = localStorage.getItem("soricia-theme"); } catch (e) { /* private mode */ }
    if (saved === "light" || saved === "dark") root.dataset.theme = saved;
    $("#theme-toggle").addEventListener("click", () => {
      const next = root.dataset.theme === "dark" ? "light" : "dark";
      root.dataset.theme = next;
      try { localStorage.setItem("soricia-theme", next); } catch (e) { /* ignore */ }
    });
  }

  function initReveal() {
    const elements = document.querySelectorAll(".reveal");
    if (!("IntersectionObserver" in window)) {
      elements.forEach((el) => el.classList.add("is-visible"));
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    elements.forEach((el) => observer.observe(el));
  }

  let initialized = false;
  function init() {
    if (initialized) return;
    initialized = true;
    initTheme();
    if (!OWNER_MODE) {
      $("#manage-btn").hidden = true;
      document.querySelectorAll("[data-open-editor]").forEach((btn) => { btn.hidden = true; });
      document.querySelectorAll(".owner-only").forEach((el) => { el.hidden = true; });
    }
    initManager();
    const year = new Date().getFullYear();
    $("#hero-year").textContent = year;
    $("#footer-year").textContent = year;
    $("#music-search").addEventListener("input", (e) => { state.songQuery = e.target.value; renderSongs(); });
    $("#anime-search").addEventListener("input", (e) => { state.animeQuery = e.target.value; renderAnime(); });
    $("#music-sort").addEventListener("change", (e) => { state.songSort = e.target.value; renderSongs(); });
    $("#anime-sort").addEventListener("change", (e) => { state.animeSort = e.target.value; renderAnime(); });
    renderAll();
    loadRatings();
    initReveal();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
