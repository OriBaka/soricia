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
  const MY_ANIME_VOTES_KEY = "soricia.my.anime.votes";
  const OWNER_KEY = "soricia.owner.mode";
  const PLAYER_POS_KEY = "soricia.player.pos";
  const TIE_KEY = "soricia.rank.ties";
  const OWNER_MODE = initOwnerMode();
  let ratings = {};
  let animeRatings = {};
  let ratingsStatus = VOTES_ENABLED ? "loading" : "off";
  let myVotes = loadMyVotes();
  let myAnimeVotes = loadMyAnimeVotes();
  let rankTies = loadRankTies();
  const voteDrafts = {};
  const animeVoteDrafts = {};

  function loadRankTies() {
    try {
      const raw = JSON.parse(localStorage.getItem(TIE_KEY) || "{}") || {};
      return Object.fromEntries(Object.entries(raw).filter(([, v]) => Number.isFinite(v)));
    } catch (e) { return {}; }
  }

  // Bài cùng điểm được xếp theo một thứ tự ngẫu nhiên, lưu lại để không đổi liên tục.
  function tieFor(song, kind = "song") {
    const key = voteKey(song, kind);
    if (!Number.isFinite(rankTies[key])) {
      rankTies[key] = Math.random();
      try { localStorage.setItem(TIE_KEY, JSON.stringify(rankTies)); } catch (e) { /* chấp nhận ngẫu nhiên trong phiên này */ }
    }
    return rankTies[key];
  }

  const $ = (selector) => document.querySelector(selector);
  const HAS_MUSIC = !!$("#music-list");
  const HAS_ANIME = !!$("#anime-list");
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
    songView: "rank", songGenre: "Tất cả", songQuery: "", songSort: "community", songVoteFilter: "all",
    animeView: "rank", animeGenre: "Tất cả", animeQuery: "", animeSort: "community", animeVoteFilter: "all"
  };
  let lastRankSort = "community";
  let lastAnimeRankSort = "community";
  // Giữ mục vừa chấm lại trong danh sách "Chưa vote" đến khi đổi bộ lọc,
  // để người xem kịp thấy điểm mình vừa ghi và điểm cộng đồng vừa hiện ra.
  const justVoted = { song: new Set(), anime: new Set() };
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

  function voteKey(item, kind = "song") {
    return (kind === "anime" ? "anime-" : "") + songKey(item);
  }

  function loadMyVotes() {
    try { return JSON.parse(localStorage.getItem(MY_VOTES_KEY) || "{}") || {}; }
    catch (e) { return {}; }
  }

  function loadMyAnimeVotes() {
    try { return JSON.parse(localStorage.getItem(MY_ANIME_VOTES_KEY) || "{}") || {}; }
    catch (e) { return {}; }
  }

  function persistMyVotes(kind = "song") {
    try {
      localStorage.setItem(kind === "anime" ? MY_ANIME_VOTES_KEY : MY_VOTES_KEY,
        JSON.stringify(kind === "anime" ? myAnimeVotes : myVotes));
    } catch (e) { /* ignore */ }
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
      const nextSongs = {};
      const nextAnime = {};
      Object.entries(data && typeof data === "object" ? data : {}).forEach(([voteId, votes]) => {
        const scores = Object.values(votes && typeof votes === "object" ? votes : {})
          .map(Number)
          .filter((n) => n >= 1 && n <= 10);
        if (!scores.length) return;
        const entry = {
          avg: scores.reduce((a, b) => a + b, 0) / scores.length,
          count: scores.length
        };
        if (voteId.startsWith("anime-")) nextAnime[voteId] = entry;
        else nextSongs[voteId] = entry;
      });
      const unchanged = ratingsStatus !== "error"
        && JSON.stringify(nextSongs) === JSON.stringify(ratings)
        && JSON.stringify(nextAnime) === JSON.stringify(animeRatings);
      ratings = nextSongs;
      animeRatings = nextAnime;
      ratingsStatus = "ready";
      if (unchanged) return; // don't wipe what a visitor is typing
    } catch (e) {
      ratingsStatus = "error";
      console.warn("Không tải được điểm bình chọn:", e);
    }
    renderSongs();
    renderAnime();
  }

  async function submitVote(kind, songId, score) {
    if (!VOTES_ENABLED) return;
    const mine = kind === "anime" ? myAnimeVotes : myVotes;
    const drafts = kind === "anime" ? animeVoteDrafts : voteDrafts;
    const changing = mine[songId] != null;
    const voteId = songId; // voteKey() already namespaces anime entries.
    try {
      const res = await fetch(firebaseUrl(VOTES_PATH + "/" + encodeURIComponent(voteId) + "/" + encodeURIComponent(voterToken())), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(score)
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      mine[songId] = score;
      persistMyVotes(kind);
      delete drafts[songId];
      justVoted[kind].add(songId);
      toast(changing ? "Đã cập nhật điểm của bạn: " + score + "." : "Đã ghi " + score + " điểm. Cảm ơn!");
      await loadRatings();
      (kind === "anime" ? renderAnime : renderSongs)();
    } catch (e) {
      toast("Không gửi được điểm. Thử lại sau.");
    }
  }

  function scoreBlock(song, kind = "song") {
    const key = voteKey(song, kind);
    const table = kind === "anime" ? animeRatings : ratings;
    const mine = kind === "anime" ? myAnimeVotes : myVotes;
    const drafts = kind === "anime" ? animeVoteDrafts : voteDrafts;
    const view = kind === "anime" ? state.animeView : state.songView;
    if (!VOTES_ENABLED) {
      return `<div class="song-score"><strong>${fmt(song.score)}</strong><small>điểm của tác giả</small><span class="vote-note">Bình chọn chưa được bật.</span></div>`;
    }
    const rating = table[key];
    const avg = rating && rating.count ? fmt(rating.avg) : "—";
    const countText = rating && rating.count ? rating.count + " lượt chấm" : "chưa có lượt chấm";
    const existing = mine[key];
    const blind = view === "vote" && existing == null;
    const stars = kind === "anime" && !blind
      ? `<span class="stars" aria-label="${Math.round((song.score || 0) / 2)}/5 sao">${"★".repeat(Math.round((song.score || 0) / 2))}${"☆".repeat(5 - Math.round((song.score || 0) / 2))}</span>`
      : "";
    const scoreInfo = blind
      ? `<span class="vote-note">Chấm điểm để xem điểm cộng đồng và điểm của tác giả.</span>`
      : `${stars}
         <strong>${avg}</strong>
         <small>điểm trung bình · ${countText}</small>
         <div class="author-score">Điểm của tác giả: <b>${fmt(song.score)}</b></div>`;
    const status = !blind && ratingsStatus === "error" ? `<span class="vote-note">Chưa tải được điểm cộng đồng.</span>` : "";
    return `
      <div class="song-score${kind === "anime" ? " anime-vote" : ""}">
        ${scoreInfo}
        <form class="vote-form" data-kind="${kind}" data-song="${esc(key)}">
          <label class="sr-only" for="vote-${kind}-${esc(key)}">Điểm của bạn cho ${kind === "anime" ? "bộ " : "bài "}${esc(song.title)}</label>
          <input id="vote-${kind}-${esc(key)}" type="text" inputmode="decimal" autocomplete="off" spellcheck="false"
                 placeholder="1–10" value="${esc(drafts[key] ?? (existing != null ? existing : ""))}">
          <button type="submit">${existing != null ? "Sửa" : "Gửi"}</button>
        </form>
        ${existing != null ? `<span class="my-vote">${justVoted[kind].has(key) ? "Bạn vừa chấm" : "Bạn đã chấm"}: ${esc(existing)} — có thể đổi</span>` : ""}
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

  function loadPlayerPos() {
    try {
      const pos = JSON.parse(localStorage.getItem(PLAYER_POS_KEY) || "null");
      return pos && Number.isFinite(pos.x) && Number.isFinite(pos.y) ? pos : null;
    } catch (e) { return null; }
  }
  let playerPos = loadPlayerPos();

  function applyPlayerPos(x, y) {
    const box = $("#player-modal .player-box");
    const maxX = Math.max(8, window.innerWidth - box.offsetWidth - 8);
    const maxY = Math.max(8, window.innerHeight - box.offsetHeight - 8);
    const left = Math.min(Math.max(8, x), maxX);
    const top = Math.min(Math.max(8, y), maxY);
    box.style.left = left + "px";
    box.style.top = top + "px";
    box.style.right = "auto";
    box.style.bottom = "auto";
    return { x: left, y: top };
  }

  function setPlayerSize(expanded) {
    const modal = $("#player-modal");
    modal.classList.toggle("is-expanded", expanded);
    modal.classList.toggle("is-mini", !expanded);
    modal.querySelector(".player-backdrop").hidden = !expanded;
    $("#player-expand").textContent = expanded ? "🗕" : "⤢";
    $("#player-expand").setAttribute("aria-label", expanded ? "Thu nhỏ trình phát" : "Phóng to trình phát");
    document.body.classList.toggle("player-expanded", expanded);
    const box = modal.querySelector(".player-box");
    if (expanded) {
      box.style.left = box.style.top = box.style.right = box.style.bottom = "";
    } else if (playerPos) {
      applyPlayerPos(playerPos.x, playerPos.y);
    }
  }

  function openPlayer(id, title) {
    if (!$("#player-modal")) return;
    const video = youtubeId(id);
    if (!video) return;
    $("#player-frame").innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(video)}?autoplay=1&rel=0" title="Nghe bài hát" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
    $("#player-title").textContent = title || "Đang nghe";
    $("#player-modal").hidden = false;
    setPlayerSize(false);
  }

  function closePlayer() {
    $("#player-modal").hidden = true;
    $("#player-frame").innerHTML = "";
    document.body.classList.remove("player-expanded");
  }

  function initPlayerDrag() {
    if (!$("#player-modal")) return;
    const handle = $("#player-modal .player-toolbar");
    const box = $("#player-modal .player-box");
    let drag = null;
    handle.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button") || $("#player-modal").classList.contains("is-expanded")) return;
      const rect = box.getBoundingClientRect();
      drag = { x: e.clientX, y: e.clientY, left: rect.left, top: rect.top, moved: false };
      box.classList.add("is-dragging");
      if (handle.setPointerCapture) handle.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    handle.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      drag.last = applyPlayerPos(drag.left + dx, drag.top + dy);
    });
    const finish = () => {
      if (!drag) return;
      if (drag.moved && drag.last) {
        playerPos = drag.last;
        try { localStorage.setItem(PLAYER_POS_KEY, JSON.stringify(playerPos)); }
        catch (err) { /* position simply won't persist */ }
      }
      drag = null;
      box.classList.remove("is-dragging");
    };
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
    window.addEventListener("resize", () => {
      if (!$("#player-modal").hidden && playerPos && $("#player-modal").classList.contains("is-mini")) {
        playerPos = applyPlayerPos(playerPos.x, playerPos.y);
      }
    });
  }

  function displayScore(song, mode, kind = "song") {
    if (mode === "community") {
      const r = (kind === "anime" ? animeRatings : ratings)[voteKey(song, kind)];
      return r && r.count ? Number(fmt(r.avg)) : -1;
    }
    return Number(fmt(song.score)) || 0;
  }

  function sortItems(items, mode, kind = "song") {
    const copy = [...items];
    if (mode === "rank") return copy.sort((a, b) => a.rank - b.rank);
    if (mode === "title") return copy.sort((a, b) => String(a.title).localeCompare(String(b.title), "vi"));
    if (mode === "year") return copy.sort((a, b) => (b.year || 0) - (a.year || 0));
    if (mode === "community" || mode === "score") {
      return copy.sort((a, b) => displayScore(b, mode, kind) - displayScore(a, mode, kind) || tieFor(a, kind) - tieFor(b, kind));
    }
    return copy;
  }

  function genresOf(item) {
    const raw = Array.isArray(item.genre) ? item.genre : String(item.genre || "").split(/[,;|]+|\s+\/\s+/);
    return [...new Set(raw.map((g) => String(g).trim()).filter(Boolean))];
  }

  function filterItems(items, genre, query, voteFilter, kind = "song") {
    const q = fold(query).trim();
    const mine = kind === "anime" ? myAnimeVotes : myVotes;
    return items.filter((item) => {
      if (genre !== "Tất cả" && !genresOf(item).includes(genre)) return false;
      const key = voteKey(item, kind);
      if (voteFilter === "voted" && mine[key] == null) return false;
      if (voteFilter === "unvoted" && mine[key] != null && !justVoted[kind].has(key)) return false;
      if (!q) return true;
      return fold([item.title, item.artist, item.genre, item.alt, item.note].filter(Boolean).join(" ")).includes(q);
    });
  }

  const uniqueGenres = (items) => [...new Set(items.flatMap(genresOf))]
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

  const VOTE_FILTERS = [
    { value: "all", label: "Tất cả" },
    { value: "voted", label: "Đã vote" },
    { value: "unvoted", label: "Chưa vote" }
  ];

  function voteContext(kind = "song") {
    return kind === "anime"
      ? { container: $("#anime-vote-filters"), stateKey: "animeVoteFilter", items: anime, mine: myAnimeVotes, render: renderAnime }
      : { container: $("#music-vote-filters"), stateKey: "songVoteFilter", items: songs, mine: myVotes, render: renderSongs };
  }

  function voteFilterCounts(kind = "song") {
    const { items, mine } = voteContext(kind);
    const voted = items.filter((item) => mine[voteKey(item, kind)] != null).length;
    return { all: items.length, voted, unvoted: items.length - voted };
  }

  function updateVoteFilterChips(kind = "song") {
    const { container, stateKey } = voteContext(kind);
    if (!container) return;
    const counts = voteFilterCounts(kind);
    container.querySelectorAll(".chip").forEach((chip) => {
      const value = chip.dataset.voteFilter;
      chip.setAttribute("aria-pressed", String(value === state[stateKey]));
      chip.querySelector(".chip-count").textContent = counts[value];
    });
  }

  function renderVoteFilterChips(kind = "song") {
    const { container, stateKey, render } = voteContext(kind);
    if (!container) return;
    const counts = voteFilterCounts(kind);
    container.innerHTML = VOTE_FILTERS.map(({ value, label }) => `
      <button type="button" class="chip" data-vote-filter="${value}" aria-pressed="${value === state[stateKey]}">
        ${label}<span class="chip-count">${counts[value]}</span>
      </button>
    `).join("");
    container.querySelectorAll(".chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        justVoted[kind].clear();
        state[stateKey] = chip.dataset.voteFilter;
        render();
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

  function setSongView(view) {
    if (!HAS_MUSIC || (view !== "rank" && view !== "vote")) return;
    state.songView = view;
    document.body.classList.toggle("vote-mode", view === "vote");
    document.querySelectorAll("#music-tabs .view-tab").forEach((tab) => {
      const active = tab.dataset.view === view;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    $("#music-title").textContent = view === "vote" ? "Chấm điểm bài hát" : "Bài hát xếp hạng theo thể loại";
    $("#music-desc-rank").hidden = view === "vote";
    $("#music-desc-vote").hidden = view !== "vote";
    if (view === "vote") {
      if (state.songSort === "score" || state.songSort === "community") {
        lastRankSort = state.songSort;
        state.songSort = "rank";
      }
    } else if (lastRankSort) {
      state.songSort = lastRankSort;
      lastRankSort = "community";
    }
    $("#music-sort").value = state.songSort;
    renderSongs();
  }

  function renderSongs() {
    if (!HAS_MUSIC) return;
    const items = sortItems(filterItems(songs, state.songGenre, state.songQuery, state.songVoteFilter, "song"), state.songSort, "song");
    const rows = items.map((song, i) => ({ song, rank: i + 1 }));
    updateVoteFilterChips("song");
    $("#music-list").innerHTML = rows.map(({ song, rank }) => `
      <li class="song${rank === 1 ? " is-top" : ""}">
        <span class="song-rank${song.image ? " has-image" : ""}" aria-label="Hạng ${rank}" title="Hạng ${rank}">
          ${song.image ? `<img src="${esc(song.image)}" alt="">` : ""}
          <b>#${String(rank).padStart(2, "0")}</b>
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
      : state.songVoteFilter === "voted" && !Object.keys(myVotes).length
        ? "Bạn chưa vote bài nào. Chuyển sang “Chưa vote” để bắt đầu nhé."
        : state.songVoteFilter === "unvoted" && Object.keys(myVotes).length >= songs.length
          ? "Bạn đã vote hết các bài rồi — cảm ơn bạn!"
          : "Không tìm thấy bài hát phù hợp. Thử đổi từ khoá hoặc thể loại nhé.";
  }

  function setAnimeView(view) {
    if (!HAS_ANIME || (view !== "rank" && view !== "vote")) return;
    state.animeView = view;
    document.body.classList.toggle("anime-vote-mode", view === "vote");
    document.querySelectorAll("#anime-tabs .view-tab").forEach((tab) => {
      const active = tab.dataset.view === view;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    $("#anime-title").textContent = view === "vote" ? "Chấm điểm anime" : "Những bộ tôi đã xem";
    $("#anime-desc-rank").hidden = view === "vote";
    $("#anime-desc-vote").hidden = view !== "vote";
    if (view === "vote") {
      if (state.animeSort === "score" || state.animeSort === "community") {
        lastAnimeRankSort = state.animeSort;
        state.animeSort = "rank";
      }
    } else if (lastAnimeRankSort) {
      state.animeSort = lastAnimeRankSort;
      lastAnimeRankSort = "community";
    }
    $("#anime-sort").value = state.animeSort;
    renderAnime();
  }

  function renderAnime() {
    if (!HAS_ANIME) return;
    const items = sortItems(filterItems(anime, state.animeGenre, state.animeQuery, state.animeVoteFilter, "anime"), state.animeSort, "anime");
    updateVoteFilterChips("anime");
    $("#anime-list").innerHTML = items.map((show, i) => {
      const [from, to] = paletteFor(show.title);
      const watching = fold(show.status).includes("dang");
      const meta = [...genresOf(show), show.year ? String(show.year) : null, show.episodes ? show.episodes + " tập" : null].filter(Boolean);
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
            <p class="anime-sub">${esc(meta.join(" · "))}</p>
            ${show.note ? `<p class="anime-note">${esc(show.note)}</p>` : ""}
            ${actionsFor("anime", show)}
            ${scoreBlock(show, "anime")}
          </div>
        </article>
      `;
    }).join("");

    $("#anime-count").textContent = String(items.length);
    const empty = $("#anime-empty");
    empty.hidden = items.length > 0;
    empty.textContent = anime.length === 0
      ? "Chưa có anime nào. Bấm “+ Thêm anime” để thêm tựa đầu tiên."
      : state.animeVoteFilter === "voted" && !Object.keys(myAnimeVotes).length
        ? "Bạn chưa vote anime nào. Chuyển sang “Chưa vote” để bắt đầu nhé."
        : state.animeVoteFilter === "unvoted" && Object.keys(myAnimeVotes).length >= anime.length
          ? "Bạn đã vote hết các anime rồi — cảm ơn bạn!"
          : "Chưa có anime nào khớp với bộ lọc này.";
  }

  function setStat(name, value) {
    const el = document.querySelector('[data-stat="' + name + '"]');
    if (el) el.textContent = value;
  }

  function fillHeroAndStats() {
    const bestSong = [...songs].sort((a, b) => (b.score || 0) - (a.score || 0))[0];
    const bestAnime = [...anime].sort((a, b) => (b.score || 0) - (a.score || 0))[0];
    if (HAS_MUSIC && $("#hero-song-title")) {
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
    }
    if (HAS_ANIME && $("#hero-anime-title")) {
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
    }
    const shown = HAS_MUSIC && HAS_ANIME ? [...songs, ...anime] : HAS_MUSIC ? songs : anime;
    const allScores = shown.map((item) => Number(item.score) || 0);
    const avg = allScores.length ? allScores.reduce((a, b) => a + b, 0) / allScores.length : 0;
    setStat("songs", songs.length);
    setStat("anime", anime.length);
    setStat("genres", new Set(shown.map((item) => item.genre).filter(Boolean)).size);
    setStat("avg", allScores.length ? fmt(avg) : "—");
  }

  function renderAll() {
    if (HAS_MUSIC && state.songGenre !== "Tất cả" && !uniqueGenres(songs).includes(state.songGenre)) state.songGenre = "Tất cả";
    if (HAS_ANIME && state.animeGenre !== "Tất cả" && !uniqueGenres(anime).includes(state.animeGenre)) state.animeGenre = "Tất cả";
    renderSongs();
    renderAnime();
    fillHeroAndStats();
    const genres = uniqueGenres(HAS_MUSIC && HAS_ANIME ? [...songs, ...anime] : HAS_MUSIC ? songs : anime);
    $("#genre-options").innerHTML = genres.map((g) => `<option value="${esc(g)}"></option>`).join("");
    if (HAS_MUSIC) {
      makeChips($("#music-filters"), uniqueGenres(songs), state.songGenre, (g) => { state.songGenre = g; renderSongs(); });
      renderVoteFilterChips("song");
    }
    if (HAS_ANIME) {
      renderVoteFilterChips("anime");
      makeChips($("#anime-filters"), uniqueGenres(anime), state.animeGenre, (g) => { state.animeGenre = g; renderAnime(); });
    }
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
    $("#manage-btn").addEventListener("click", () => openPanel(HAS_ANIME && !HAS_MUSIC ? "anime" : "song"));
    $("#panel-close").addEventListener("click", closePanel);
    $("#panel-backdrop").addEventListener("click", closePanel);
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      const modal = $("#player-modal");
      if (modal && !modal.hidden) {
        if (modal.classList.contains("is-expanded")) setPlayerSize(false);
        else closePlayer();
      } else if (document.body.classList.contains("panel-open")) closePanel();
    });
    document.querySelectorAll(".panel-tab").forEach((btn) => {
      btn.addEventListener("click", () => setTab(btn.dataset.tab));
    });

    document.addEventListener("click", (e) => {
      if (e.target.closest("[data-close-player]")) { closePlayer(); return; }
      if (e.target.closest("[data-toggle-player]")) {
        const modal = $("#player-modal");
        if (modal) setPlayerSize(!modal.classList.contains("is-expanded"));
        return;
      }
      const play = e.target.closest("[data-play]");
      if (play) { openPlayer(play.dataset.play, play.dataset.title); return; }
      const opener = e.target.closest("[data-open-editor]");
      if (opener) { openPanel(opener.dataset.openEditor); return; }
      const button = e.target.closest("button[data-action]");
      if (!button) return;
      if (button.dataset.action === "vote") { submitVote("song", button.dataset.id, Number(button.dataset.score)); return; }
      if (button.dataset.action === "edit") openPanel(button.dataset.type, button.dataset.id);
      if (button.dataset.action === "delete") deleteItem(button.dataset.type, button.dataset.id);
    });

    document.addEventListener("input", (e) => {
      if (!e.target.matches(".vote-form input")) return;
      const form = e.target.closest("form.vote-form");
      const drafts = form.dataset.kind === "anime" ? animeVoteDrafts : voteDrafts;
      drafts[form.dataset.song] = e.target.value;
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
      submitVote(form.dataset.kind || "song", form.dataset.song, score);
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
        // Mỗi lần xuất là một phiên bản mới: người xem sẽ bỏ dữ liệu cũ trong localStorage.
        version: new Date().toISOString(),
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
    initPlayerDrag();
    const year = new Date().getFullYear();
    $("#hero-year").textContent = year;
    $("#footer-year").textContent = year;
    if (HAS_MUSIC) {
      document.querySelectorAll("#music-tabs .view-tab").forEach((tab) => {
        tab.addEventListener("click", () => setSongView(tab.dataset.view));
      });
      $("#music-search").addEventListener("input", (e) => { state.songQuery = e.target.value; renderSongs(); });
      $("#music-sort").addEventListener("change", (e) => { state.songSort = e.target.value; renderSongs(); });
    }
    if (HAS_ANIME) {
      document.querySelectorAll("#anime-tabs .view-tab").forEach((tab) => {
        tab.addEventListener("click", () => setAnimeView(tab.dataset.view));
      });
      $("#anime-search").addEventListener("input", (e) => { state.animeQuery = e.target.value; renderAnime(); });
      $("#anime-sort").addEventListener("change", (e) => { state.animeSort = e.target.value; renderAnime(); });
    }
    renderAll();
    loadRatings();
    initReveal();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
