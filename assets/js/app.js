/* Soricia — rendering, in-page manager, filters and local persistence. */
(function () {
  "use strict";

  const SEED = JSON.parse(JSON.stringify(window.SITE_DATA || { profile: {}, songs: [], anime: [] }));
  const SEED_VERSION = SEED.version || "seed";
  let currentVersion = SEED_VERSION;
  let lastSyncAt = null;
  let pendingRemoteVersion = null;
  let dailySong = null;
  const STORAGE_KEY = "soricia.collection.v1";
  const VERSION_KEY = "soricia.collection.version";
  const BACKUP_KEY = "soricia.collection.backup.v1";
  const HISTORY_KEY = "soricia.owner.history.v1";

  const CONFIG = window.SITE_CONFIG || {};
  const FIREBASE_URL = String(CONFIG.firebaseUrl || "").replace(/\/+$/, "");
  const VOTES_PATH = String(CONFIG.votesPath || "votes").replace(/^\/+|\/+$/g, "");
  const COLLECTION_PATH = String(CONFIG.collectionPath || "collection").replace(/^\/+|\/+$/g, "");
  const AUTH_API_KEY = String(CONFIG.authApiKey || "").trim();
  const AUTH_ENABLED = !!FIREBASE_URL && !!AUTH_API_KEY && !/^THAY_/.test(AUTH_API_KEY);
  const STORAGE_BUCKET = String(CONFIG.storageBucket || "").trim();
  const STORAGE_ENABLED = !!STORAGE_BUCKET;
  const VOTES_ENABLED = !!FIREBASE_URL;
  const VOTER_KEY = "soricia.voter.token";
  const MY_VOTES_KEY = "soricia.my.votes";
  const MY_ANIME_VOTES_KEY = "soricia.my.anime.votes";
  const OWNER_KEY = "soricia.owner.mode";
  const AUTH_KEY = "soricia.auth";
  const AUTH_BASE = "https://identitytoolkit.googleapis.com/v1";
  const PLAYER_POS_KEY = "soricia.player.pos";
  const TIE_KEY = "soricia.rank.ties";
  let auth = loadAuth();
  let OWNER_MODE = initOwnerMode();
  let managerVisible = OWNER_MODE || (new URLSearchParams(window.location.search).get("admin") !== null && new URLSearchParams(window.location.search).get("admin") !== "0");
  let ratings = {};
  let animeRatings = {};
  let ratingsStatus = VOTES_ENABLED ? "loading" : "off";
  let myVotes = loadMyVotes();
  let myAnimeVotes = loadMyAnimeVotes();
  let rankTies = loadRankTies();
  const voteDrafts = {};
  const animeVoteDrafts = {};

  // Ảnh do người dùng tải lên được cất trong IndexedDB. localStorage/Firebase
  // chỉ giữ mã tham chiếu idb:<key>, nên không bị vướng hạn mức ~5MB.
  const imageCache = new Map();
  const IDB_NAME = "soricia";
  const IDB_STORE = "images";
  let imageDbPromise = null;
  const isDataImage = (value) => typeof value === "string" && /^data:image\//i.test(value);
  const isIdbImage = (value) => typeof value === "string" && value.startsWith("idb:");

  function openImageDb() {
    if (typeof indexedDB === "undefined") return Promise.reject(new Error("no indexedDB"));
    if (!imageDbPromise) {
      imageDbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(IDB_STORE)) req.result.createObjectStore(IDB_STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }).catch((err) => { imageDbPromise = null; throw err; });
    }
    return imageDbPromise;
  }

  async function uploadToStorage(dataUrl) {
    if (!STORAGE_ENABLED || !AUTH_ENABLED) return null;
    try {
      const token = await ensureAuth();
      const match = String(dataUrl).match(/^data:([^;,]+);base64,(.*)$/s);
      if (!match) return null;
      const mime = match[1];
      const ext = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" })[mime.toLowerCase()] || "jpg";
      const name = "covers/" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8) + "." + ext;
      const binary = atob(match[2]);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const res = await fetch("https://firebasestorage.googleapis.com/v0/b/" + encodeURIComponent(STORAGE_BUCKET) + "/o?name=" + encodeURIComponent(name), {
        method: "POST",
        headers: { "Authorization": "Bearer " + token, "Content-Type": mime },
        body: bytes
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const info = await res.json();
      if (!info.name || !info.downloadTokens) throw new Error("phản hồi Storage không hợp lệ");
      return "https://firebasestorage.googleapis.com/v0/b/" + STORAGE_BUCKET + "/o/" + encodeURIComponent(info.name)
        + "?alt=media&token=" + info.downloadTokens;
    } catch (e) {
      console.warn("Không upload được ảnh lên Storage:", e);
      return null;
    }
  }

  async function putImage(dataUrl) {
    let ref = dataUrl;
    let prepared = dataUrl;
    try { prepared = (await compressDataUrl(dataUrl)) || dataUrl; } catch (e) { /* giữ ảnh gốc */ }
    try {
      const key = "img-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
      const db = await openImageDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).put(prepared, key);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      ref = "idb:" + key;
      imageCache.set(ref, prepared);
    } catch (e) { /* IndexedDB bị chặn: vẫn giữ data URL */ }
    const uploaded = await uploadToStorage(prepared);
    if (uploaded) {
      imageCache.set(uploaded, prepared);
      return uploaded;
    }
    return ref;
  }

  async function getImage(ref) {
    if (imageCache.has(ref)) return imageCache.get(ref);
    try {
      const db = await openImageDb();
      const value = await new Promise((resolve, reject) => {
        const req = db.transaction(IDB_STORE, "readonly").objectStore(IDB_STORE).get(String(ref).slice(4));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      if (value) { imageCache.set(ref, value); return value; }
    } catch (e) { /* ignore */ }
    return null;
  }

  async function cleanupUnusedImages() {
    if (!OWNER_MODE) { toast("Chỉ chủ web mới dọn được ảnh."); return; }
    try {
      const used = new Set();
      const scan = (value) => {
        if (typeof value === "string") {
          if (value.startsWith("idb:")) used.add(value.slice(4));
        } else if (Array.isArray(value)) value.forEach(scan);
        else if (value && typeof value === "object") Object.values(value).forEach(scan);
      };
      scan({ songs, anime });
      try { scan(JSON.parse(localStorage.getItem(BACKUP_KEY) || "null")); } catch (e) { /* bỏ qua bản sao hỏng */ }
      imageCache.forEach((_, ref) => { if (ref.startsWith("idb:")) used.add(ref.slice(4)); });
      const db = await openImageDb();
      const keys = await new Promise((resolve, reject) => {
        const req = db.transaction(IDB_STORE, "readonly").objectStore(IDB_STORE).getAllKeys();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
      const stale = keys.filter((key) => typeof key === "string" && key.startsWith("img-") && !used.has(key));
      if (!stale.length) { toast("Không có ảnh cũ để dọn."); return; }
      await new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readwrite");
        const store = tx.objectStore(IDB_STORE);
        stale.forEach((key) => store.delete(key));
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      stale.forEach((key) => imageCache.delete("idb:" + key));
      recordHistory("cleanup", "images", stale.length + " ảnh");
      toast("Đã dọn " + stale.length + " ảnh cũ không dùng.");
    } catch (e) {
      toast("Không dọn được ảnh: " + e.message);
    }
  }

  function isNew(item) {
    if (!item || !item.addedAt) return false;
    const added = Date.parse(item.addedAt);
    return Number.isFinite(added) && Date.now() - added < 7 * 24 * 60 * 60 * 1000;
  }

  function displayImage(item) {
    const value = item && item.image;
    return isIdbImage(value) ? (imageCache.get(value) || null) : value;
  }

  async function stashDataImages() {
    for (const list of [songs, anime]) {
      for (const item of list) {
        if (isDataImage(item.image)) {
          const original = item.image;
          const ref = await putImage(original);
          if (ref !== original) item.image = ref;
        }
      }
    }
  }

  async function hydrateImageCache() {
    const refs = [...new Set([...songs, ...anime].map((item) => item.image).filter(isIdbImage))];
    await Promise.all(refs.map(getImage));
  }

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
  const fmt = (score) => (score == null || score === "" || !Number.isFinite(Number(score)))
    ? "—" : Number(score).toFixed(1);

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
  const normalizeScore = (value) => {
    if (value == null || String(value).trim() === "") return null;
    const number = Number(String(value).replace(",", "."));
    return Number.isFinite(number) ? Math.min(10, Math.max(0, number)) : null;
  };
  const animeStatus = (item) => (item && item.status ? item.status : "Đã xem");
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
      clean.score = normalizeScore(clean.score);
      if (!clean.genre) clean.genre = "Khác";
      if (clean.image && !/^(data:image\/|idb:|https?:\/\/|\.{0,2}\/|assets\/)/i.test(clean.image)) clean.image = null;
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
    animeView: "rank", animeGenre: "Tất cả", animeQuery: "", animeSort: "community", animeVoteFilter: "all", animeStatusFilter: "Tất cả"
  };
  let lastRankSort = "community";
  let lastAnimeRankSort = "community";
  // Giữ mục vừa chấm lại trong danh sách "Chưa vote" đến khi đổi bộ lọc,
  // để người xem kịp thấy điểm mình vừa ghi và điểm cộng đồng vừa hiện ra.
  const justVoted = { song: new Set(), anime: new Set() };
  const pendingImages = { song: null, anime: null };
  let lastFocused = null;

  function loadAuth() {
    try {
      const raw = JSON.parse(localStorage.getItem(AUTH_KEY) || "null");
      return raw && raw.idToken ? raw : null;
    } catch (e) { return null; }
  }

  function saveAuth() {
    try {
      if (auth) localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
      else localStorage.removeItem(AUTH_KEY);
    } catch (e) { /* ignore */ }
  }

  function authValid() {
    return !!(auth && auth.idToken && (!auth.expiresAt || auth.expiresAt > Date.now()));
  }

  function initOwnerMode() {
    const params = new URLSearchParams(window.location.search);
    if (params.get("admin") === "0" && AUTH_ENABLED) {
      auth = null;
      saveAuth();
    }
    let enabled;
    if (AUTH_ENABLED) enabled = authValid();
    else {
      if (params.has("admin")) {
        try {
          if (params.get("admin") === "0") localStorage.removeItem(OWNER_KEY);
          else localStorage.setItem(OWNER_KEY, "1");
        } catch (e) { /* ignore */ }
      }
      try { enabled = localStorage.getItem(OWNER_KEY) === "1"; } catch (e) { enabled = false; }
    }
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

  function firebaseUrl(path, token) {
    const authParam = token ? "?auth=" + encodeURIComponent(token) : "";
    return FIREBASE_URL + "/" + String(path || "").replace(/^\/+/, "") + ".json" + authParam;
  }

  async function authRequest(endpoint, body) {
    const res = await fetch(AUTH_BASE + "/" + endpoint + "?key=" + encodeURIComponent(AUTH_API_KEY), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error((data.error && data.error.message) || "HTTP " + res.status);
    return data;
  }

  async function ensureAuth() {
    if (!auth || !auth.idToken) throw new Error("Chưa đăng nhập chủ web.");
    if (auth.expiresAt && auth.expiresAt - 60000 <= Date.now()) {
      if (!auth.refreshToken) throw new Error("Phiên đăng nhập hết hạn. Đăng nhập lại nhé.");
      const data = await authRequest("accounts:refreshToken", {
        grant_type: "refresh_token", refresh_token: auth.refreshToken
      });
      auth.idToken = data.id_token || data.idToken;
      auth.expiresAt = Date.now() + (Number(data.expires_in || data.expiresIn) || 3600) * 1000;
      saveAuth();
    }
    return auth.idToken;
  }

  async function signInOwner(email, password) {
    const data = await authRequest("accounts:signInWithPassword", {
      email, password, returnSecureToken: true
    });
    auth = {
      idToken: data.idToken,
      refreshToken: data.refreshToken,
      email: data.email || email,
      expiresAt: Date.now() + (Number(data.expiresIn) || 3600) * 1000
    };
    saveAuth();
    OWNER_MODE = true;
    managerVisible = true;
    applyOwnerUi();
    renderAll();
    await pullRemoteCollection();
  }

  function signOutOwner() {
    auth = null;
    saveAuth();
    OWNER_MODE = false;
    const params = new URLSearchParams(window.location.search);
    managerVisible = params.has("admin") && params.get("admin") !== "0";
    applyOwnerUi();
    renderAll();
    toast("Đã đăng xuất chủ web.");
  }

  function applyOwnerUi() {
    document.body.classList.toggle("owner-mode", OWNER_MODE);
    const manage = $("#manage-btn");
    if (manage) manage.hidden = !managerVisible;
    document.querySelectorAll("[data-open-editor]").forEach((btn) => { btn.hidden = !OWNER_MODE; });
    document.querySelectorAll(".owner-only").forEach((el) => { el.hidden = !OWNER_MODE; });
    const box = $("#auth-box");
    if (box) box.hidden = !managerVisible || !AUTH_ENABLED;
    const tabs = document.querySelector(".panel-tabs");
    if (tabs) tabs.hidden = !OWNER_MODE;
    const signin = $("#auth-signin");
    if (signin) signin.hidden = OWNER_MODE;
    const signout = $("#auth-signout");
    if (signout) signout.hidden = !OWNER_MODE;
    const publish = $("#auth-publish");
    if (publish) publish.hidden = !OWNER_MODE;
    const status = $("#auth-status");
    if (status && !OWNER_MODE) { status.hidden = true; status.textContent = ""; }
    renderHistory();
  }

  function findLinkedItem(kind, key) {
    const list = kind === "song" ? songs : anime;
    return list.find((item) => voteKey(item, kind) === key || songKey(item) === key);
  }

  function applyDeepLink() {
    const match = String(window.location.hash || "").match(/^#item=(song|anime):(.+)$/);
    if (!match) return;
    const kind = match[1];
    const key = decodeURIComponent(match[2]);
    const item = findLinkedItem(kind, key);
    if (!item) return;
    const prefix = kind === "song" ? "song" : "anime";
    state[prefix + "VoteFilter"] = "all";
    state[prefix + "Query"] = "";
    state[prefix + "Genre"] = "Tất cả";
    if (kind === "anime") state.animeStatusFilter = "Tất cả";
    const input = $("#" + prefix + "-search");
    if (input) input.value = "";
    renderAll();
    const target = [...document.querySelectorAll("[data-item-id]")]
      .find((el) => el.getAttribute("data-item-id") === item.id);
    if (target) {
      target.classList.add("is-linked");
      if (target.scrollIntoView) target.scrollIntoView({ block: "center", behavior: "smooth" });
      window.setTimeout(() => target.classList.remove("is-linked"), 3500);
    }
  }

  async function copyShareLink(kind, key) {
    const url = window.location.origin + window.location.pathname + "#item=" + kind + ":" + encodeURIComponent(key);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const input = document.createElement("textarea");
        input.value = url;
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        input.remove();
      }
      toast("Đã copy link chia sẻ.");
    } catch (e) {
      window.prompt("Copy link này:", url);
    }
  }

  async function checkRemoteUpdates() {
    if (!AUTH_ENABLED || !FIREBASE_URL || !COLLECTION_PATH) return;
    try {
      const res = await fetch(firebaseUrl(COLLECTION_PATH + "/version"));
      if (!res.ok) return;
      const version = await res.json();
      if (!version || version === currentVersion) return;
      if (document.body.classList.contains("panel-open")) {
        pendingRemoteVersion = version;
        const banner = $("#remote-banner");
        if (banner) {
          $("#remote-banner-text").textContent = "Có dữ liệu mới trên Firebase. Tải bản mới để xem.";
          banner.hidden = false;
        }
        return;
      }
      pendingRemoteVersion = null;
      await pullRemoteCollection();
      applyDeepLink();
    } catch (e) { /* bỏ qua lỗi mạng, thử lại lần sau */ }
  }

  async function runHealthCheck() {
    const out = $("#health-result");
    if (!out) return;
    out.hidden = false;
    out.textContent = "Đang kiểm tra…";
    if (!AUTH_ENABLED || !FIREBASE_URL || !COLLECTION_PATH) {
      out.textContent = "Firebase chưa được cấu hình trong data/config.js.";
      return;
    }
    const lines = [];
    let readOk = false;
    let remoteCount = "?";
    try {
      const res = await fetch(firebaseUrl(COLLECTION_PATH));
      readOk = res.ok;
      if (res.ok) {
        const data = await res.json();
        remoteCount = ((data && data.songs) || []).length + ((data && data.anime) || []).length;
      }
    } catch (e) { /* hiển thị lỗi bên dưới */ }
    lines.push((readOk ? "✓" : "✗") + " Đọc dữ liệu công khai: " + (readOk ? "OK" : "thất bại — kiểm tra Rules đã Publish chưa"));
    lines.push("Số mục: trên web " + (songs.length + anime.length) + " · trên Firebase " + remoteCount);
    lines.push("Lần đồng bộ cuối: " + (lastSyncAt ? new Date(lastSyncAt).toLocaleString("vi-VN") : "chưa có trong phiên này"));
    const key = COLLECTION_PATH + "/__healthcheck";
    try {
      const token = await ensureAuth();
      const res = await fetch(firebaseUrl(key, token), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ at: new Date().toISOString() })
      });
      if (res.ok) {
        lines.push("✓ Ghi dữ liệu chủ web: OK — Rules đã đúng.");
        try { await fetch(firebaseUrl(key, token), { method: "DELETE" }); } catch (e) { /* key tạm tự bị ghi đè lần sau */ }
      } else {
        lines.push("✗ Ghi dữ liệu: HTTP " + res.status + " — cần đăng nhập đúng chủ web và Publish Rules.");
      }
    } catch (e) {
      lines.push("✗ Ghi dữ liệu: " + e.message + " — hãy đăng nhập chủ web trước.");
    }
    out.textContent = lines.join("\n");
  }

  async function publicCollection(collection) {
    const source = collection || { songs, anime };
    const clean = async (item) => {
      const { id, index, ...rest } = item;
      if (isIdbImage(rest.image)) rest.image = (await getImage(rest.image)) || null;
      return rest;
    };
    return {
      version: currentVersion,
      profile: SEED.profile || {},
      songs: await Promise.all(source.songs.map(clean)),
      anime: await Promise.all(source.anime.map(clean))
    };
  }

  async function pullRemoteCollection() {
    if (!AUTH_ENABLED || !FIREBASE_URL || !COLLECTION_PATH) return;
    try {
      const res = await fetch(firebaseUrl(COLLECTION_PATH));
      if (!res.ok) return;
      const data = await res.json();
      if (!data || !Array.isArray(data.songs) || !Array.isArray(data.anime)) return;
      if (data.version) currentVersion = data.version;
      lastSyncAt = Date.now();
      songs = normalize(data.songs, "song");
      anime = normalize(data.anime, "anime");
      await stashDataImages();
      await hydrateImageCache();
      save();
      renderAll();
      applyDeepLink();
    } catch (e) {
      console.warn("Không tải được danh sách từ Firebase:", e);
    }
  }

  async function pushRemoteCollection(collection) {
    if (!AUTH_ENABLED || !COLLECTION_PATH) return false;
    const token = await ensureAuth();
    const res = await fetch(firebaseUrl(COLLECTION_PATH, token), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(await publicCollection(collection))
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return true;
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
      return `<div class="song-score"><strong>${fmt(song.score)}</strong><small>điểm gốc</small><span class="vote-note">Bình chọn chưa được bật.</span></div>`;
    }
    const rating = table[key];
    const avg = rating && rating.count ? fmt(rating.avg) : "—";
    const countText = rating && rating.count ? rating.count + " lượt chấm" : "chưa có lượt chấm";
    const existing = mine[key];
    const blind = view === "vote" && existing == null;
    const authorScore = song.score == null ? "—" : fmt(song.score);
    const stars = kind === "anime" && !blind && song.score != null
      ? `<span class="stars" aria-label="${Math.round((song.score || 0) / 2)}/5 sao">${"★".repeat(Math.round((song.score || 0) / 2))}${"☆".repeat(5 - Math.round((song.score || 0) / 2))}</span>`
      : "";
    const scoreInfo = blind
      ? `<span class="vote-note">Chấm điểm để xem điểm cộng đồng và điểm gốc.</span>`
      : `${stars}
         <strong>${avg}</strong>
         <small>điểm trung bình · ${countText}</small>
         <div class="author-score">Điểm gốc: <b>${authorScore}</b></div>`;
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

  function save(collection) {
    const source = collection || { songs, anime };
    const json = JSON.stringify(compactCollection({
      songs: source.songs.map(toPublic), anime: source.anime.map(toPublic)
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

  function toast(message, actionLabel, onAction) {
    const el = $("#toast");
    if (!el) return;
    el.textContent = "";
    const text = document.createElement("span");
    text.textContent = message;
    el.appendChild(text);
    if (actionLabel && typeof onAction === "function") {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "toast-action";
      button.textContent = actionLabel;
      button.addEventListener("click", () => {
        clearTimeout(toast.timer);
        el.classList.remove("is-visible");
        onAction();
      });
      el.appendChild(button);
    }
    el.classList.add("is-visible");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove("is-visible"), actionLabel ? 8000 : 2800);
  }

  const HISTORY_LABELS = {
    add: "Thêm", edit: "Sửa", delete: "Xoá", restore: "Khôi phục", status: "Đổi trạng thái",
    bulk: "Thêm hàng loạt", import: "Nhập dữ liệu", reset: "Về dữ liệu gốc",
    publish: "Đăng lên web", cleanup: "Dọn ảnh"
  };

  function loadHistory() {
    try {
      const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) { return []; }
  }

  function recordHistory(action, kind, title) {
    if (!OWNER_MODE) return; // nhật ký chỉ dành cho chủ web, không đẩy lên Firebase
    try {
      const entries = loadHistory();
      entries.unshift({ at: new Date().toISOString(), action, kind, title });
      localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, 60)));
    } catch (e) { /* bỏ qua nếu bộ nhớ đầy */ }
    renderHistory();
  }

  function renderHistory() {
    const box = $("#history-box");
    const list = $("#history-list");
    if (!box || !list) return;
    box.hidden = !OWNER_MODE;
    if (!OWNER_MODE) { list.textContent = ""; return; }
    const entries = loadHistory();
    list.innerHTML = entries.length
      ? entries.map((entry) => {
        const when = new Date(entry.at);
        const time = Number.isFinite(when.getTime()) ? when.toLocaleString("vi-VN") : "—";
        return `<p><time>${esc(time)}</time> · ${esc(HISTORY_LABELS[entry.action] || entry.action)} `
          + `${esc(entry.kind || "")} <b>${esc(entry.title || "")}</b></p>`;
      }).join("")
      : "<p>Chưa có thay đổi nào được ghi lại.</p>";
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
    return song.score == null ? -1 : (Number(fmt(song.score)) || 0);
  }

  function sortItems(items, mode, kind = "song") {
    const copy = [...items];
    if (mode === "rank") return copy.sort((a, b) => a.rank - b.rank);
    if (mode === "title") return copy.sort((a, b) => String(a.title).localeCompare(String(b.title), "vi"));
    if (mode === "year") return copy.sort((a, b) => (b.year || 0) - (a.year || 0));
    if (mode === "new") return copy.sort((a, b) =>
      ((Date.parse(b.addedAt) || 0) - (Date.parse(a.addedAt) || 0)) || ((b.index || 0) - (a.index || 0)));
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
      if (kind === "anime" && state.animeStatusFilter !== "Tất cả"
        && animeStatus(item) !== state.animeStatusFilter) return false;
      if (!q) return true;
      return fold([item.title, item.artist, item.genre, item.alt, item.note].filter(Boolean).join(" ")).includes(q);
    });
  }

  const uniqueGenres = (items) => [...new Set(items.flatMap(genresOf))]
    .sort((a, b) => String(a).localeCompare(String(b), "vi"));

  function makeChips(container, genres, active, onSelect, counts) {
    container.innerHTML = ["Tất cả", ...genres].map((genre) => {
      const count = counts && counts[genre] != null
        ? ` <small class="chip-count">${counts[genre]}</small>` : "";
      return `<button type="button" class="chip" data-genre="${esc(genre)}" aria-pressed="${genre === active}">${esc(genre)}${count}</button>`;
    }).join("");
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

  function updateVoteProgress(kind = "song") {
    const prefix = kind === "song" ? "music" : "anime";
    const wrap = $("#" + prefix + "-progress");
    if (!wrap) return;
    const list = kind === "song" ? songs : anime;
    const mine = kind === "song" ? myVotes : myAnimeVotes;
    const voted = list.filter((item) => mine[voteKey(item, kind)] != null).length;
    const total = list.length;
    const pct = total ? Math.round((voted / total) * 100) : 0;
    $("#" + prefix + "-progress-label").textContent = voted + " / " + total + " " + (kind === "song" ? "bài" : "anime");
    const bar = $("#" + prefix + "-progress-bar");
    if (bar) {
      bar.style.width = pct + "%";
      const track = bar.parentElement;
      if (track) {
        track.setAttribute("aria-valuemin", "0");
        track.setAttribute("aria-valuemax", String(total));
        track.setAttribute("aria-valuenow", String(voted));
      }
    }
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
    const progress = $("#music-progress");
    if (progress) progress.hidden = view !== "vote";
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
    const rows = items.map((song, i) => ({ song, rank: i + 1, cover: displayImage(song) }));
    updateVoteFilterChips("song");
    updateVoteProgress("song");
    $("#music-list").innerHTML = rows.map(({ song, rank, cover }) => `
      <li class="song${rank === 1 ? " is-top" : ""}" data-item-id="${esc(song.id)}">
        <span class="song-rank${cover ? " has-image" : ""}" aria-label="Hạng ${rank}" title="Hạng ${rank}">
          ${cover ? `<img src="${esc(cover)}" alt="">` : ""}
          <b>#${String(rank).padStart(2, "0")}</b>
        </span>
        <div class="song-main">
          <div class="song-title-line">
            <h3 class="song-title">${esc(song.title)}</h3>
            ${isNew(song) ? `<span class="new-badge">MỚI</span>` : ""}
            <span class="song-artist">${esc(song.artist)}</span>
          </div>
          ${song.note ? `<p class="song-note">${esc(song.note)}</p>` : ""}
          <div class="song-meta">
            <span class="genre-badge">${esc(song.genre)}</span>
            ${song.year ? `<span>${esc(song.year)}</span>` : ""}
            <span class="meter" title="${song.score == null ? "Chưa chấm" : "Điểm " + fmt(song.score) + "/10"}"><span style="width:${Math.min(100, Math.max(0, (Number(song.score) || 0) * 10))}%"></span></span>
          </div>
          ${actionsFor("song", song)}
          <div class="listen-row">
            <button type="button" class="share-btn" data-share="song" data-share-key="${esc(voteKey(song, "song"))}" aria-label="Chia sẻ bài ${esc(song.title)}">🔗 Chia sẻ</button>
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
      ? "Chưa có bài hát nào để bình chọn."
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
    $("#anime-section-title").textContent = view === "vote" ? "Chấm điểm anime" : "Những bộ anime được bình chọn";
    $("#anime-desc-rank").hidden = view === "vote";
    $("#anime-desc-vote").hidden = view !== "vote";
    const progress = $("#anime-progress");
    if (progress) progress.hidden = view !== "vote";
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
    updateVoteProgress("anime");
    $("#anime-list").innerHTML = items.map((show, i) => {
      const [from, to] = paletteFor(show.title);
      const cover = displayImage(show);
      const status = animeStatus(show);
      const watching = status === "Đang xem";
      const unwatched = status === "Chưa xem";
      const meta = [...genresOf(show), show.year ? String(show.year) : null, show.episodes ? show.episodes + " tập" : null].filter(Boolean);
      return `
        <article class="anime-card" data-item-id="${esc(show.id)}">
          <div class="anime-cover" style="--c1:${from};--c2:${to}">
            ${cover ? `<img class="anime-cover-img" src="${esc(cover)}" alt="">` : ""}
            <span class="status-tag${watching ? " is-watching" : ""}${unwatched ? " is-unwatched" : ""}">${esc(status)}</span>
            <span class="anime-cover-rank">#${String(i + 1).padStart(2, "0")}</span>
            <span class="anime-initials">${esc(initialsFor(show.title))}</span>
          </div>
          <div class="anime-body">
            <h3 class="anime-title">${esc(show.title)}</h3>
            ${isNew(show) ? `<span class="new-badge">MỚI</span>` : ""}
            ${show.alt ? `<p class="anime-sub">${esc(show.alt)}</p>` : ""}
            <p class="anime-sub">${esc(meta.join(" · "))}</p>
            ${show.note ? `<p class="anime-note">${esc(show.note)}</p>` : ""}
            <button type="button" class="status-toggle" data-status-toggle="${esc(show.id)}">${status === "Chưa xem" ? "▶ Bắt đầu xem" : watching ? "✓ Đã xem xong" : "↺ Chưa xem"}</button>
            <button type="button" class="share-btn" data-share="anime" data-share-key="${esc(voteKey(show, "anime"))}" aria-label="Chia sẻ anime ${esc(show.title)}">🔗 Chia sẻ</button>
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
      ? "Chưa có anime nào để bình chọn."
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
    const bestSong = [...songs].sort((a, b) => (Number(b.score ?? -1) - Number(a.score ?? -1)))[0];
    const bestAnime = [...anime].sort((a, b) => (Number(b.score ?? -1) - Number(a.score ?? -1)))[0];
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
    const allScores = shown.map((item) => normalizeScore(item.score)).filter((score) => score != null);
    const avg = allScores.length ? allScores.reduce((a, b) => a + b, 0) / allScores.length : null;
    setStat("songs", songs.length);
    setStat("anime", anime.length);
    setStat("genres", new Set(shown.map((item) => item.genre).filter(Boolean)).size);
    setStat("avg", allScores.length ? fmt(avg) : "—");
  }

  function dailySeed() {
    const pinned = new URLSearchParams(window.location.search).get("daily") || "";
    return /^\d{4}-\d{2}-\d{2}$/.test(pinned) ? pinned : new Date().toISOString().slice(0, 10);
  }

  function hashText(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function pickDailySong() {
    if (!songs.length) return null;
    const seed = dailySeed();
    return songs
      .map((song) => ({ song, hash: hashText(seed + "|" + voteKey(song, "song")) }))
      .sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0))[0].song;
  }

  function renderDailyPick() {
    const box = $("#daily-box");
    if (!box) return;
    dailySong = pickDailySong();
    box.hidden = !dailySong;
    if (!dailySong) return;
    $("#daily-date").textContent = dailySeed();
    $("#daily-title").textContent = dailySong.title;
    $("#daily-artist").textContent = dailySong.artist || "";
  }

  function renderAll() {
    if (HAS_MUSIC && state.songGenre !== "Tất cả" && !uniqueGenres(songs).includes(state.songGenre)) state.songGenre = "Tất cả";
    if (HAS_ANIME && state.animeGenre !== "Tất cả" && !uniqueGenres(anime).includes(state.animeGenre)) state.animeGenre = "Tất cả";
    if (HAS_ANIME && state.animeStatusFilter !== "Tất cả"
      && !new Set(anime.map(animeStatus)).has(state.animeStatusFilter)) state.animeStatusFilter = "Tất cả";
    renderSongs();
    renderAnime();
    fillHeroAndStats();
    renderDailyPick();
    const genres = uniqueGenres(HAS_MUSIC && HAS_ANIME ? [...songs, ...anime] : HAS_MUSIC ? songs : anime);
    $("#genre-options").innerHTML = genres.map((g) => `<option value="${esc(g)}"></option>`).join("");
    if (HAS_MUSIC) {
      makeChips($("#music-filters"), uniqueGenres(songs), state.songGenre, (g) => { state.songGenre = g; renderSongs(); });
      renderVoteFilterChips("song");
    }
    if (HAS_ANIME) {
      renderVoteFilterChips("anime");
      makeChips($("#anime-filters"), uniqueGenres(anime), state.animeGenre, (g) => { state.animeGenre = g; renderAnime(); });
      const statusLabels = ["Chưa xem", "Đang xem", "Đã xem"];
      const statusCounts = { "Tất cả": anime.length };
      statusLabels.forEach((label) => {
        statusCounts[label] = anime.filter((x) => animeStatus(x) === label).length;
      });
      makeChips($("#anime-status-filters"), statusLabels, state.animeStatusFilter,
        (v) => { state.animeStatusFilter = v; renderAnime(); }, statusCounts);
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
          resolve(putImage(canvas.toDataURL("image/jpeg", 0.82)));
        };
        img.onerror = () => resolve(putImage(reader.result));
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
    const resolved = isIdbImage(value) ? (imageCache.get(value) || null) : value;
    if (resolved) {
      img.src = resolved; img.hidden = false;
      placeholder.hidden = true; remove.hidden = false;
    } else {
      img.removeAttribute("src"); img.hidden = true;
      placeholder.hidden = false; remove.hidden = !!value;
    }
  }

  async function findAnimePoster() {
    const input = $("#anime-title");
    const title = input ? input.value.trim() : "";
    if (!title) {
      formError("anime", "Nhập tên anime trước khi tìm poster nhé.", "anime-title");
      return;
    }
    const status = $("#anime-form-status");
    if (status) { status.textContent = "Đang tìm poster…"; status.hidden = false; }
    try {
      const res = await fetch("https://api.jikan.moe/v4/anime?q=" + encodeURIComponent(title) + "&limit=3");
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      const results = Array.isArray(data.data) ? data.data : [];
      const wanted = fold(title);
      const exact = results.find((a) => fold(a.title || "") === wanted)
        || results.find((a) => fold(a.title || "").includes(wanted) || wanted.includes(fold(a.title || "")));
      const chosen = exact || results[0];
      const images = chosen && chosen.images && chosen.images.jpg;
      const url = images && (images.large_image_url || images.image_url);
      if (!url) throw new Error("Không tìm thấy poster phù hợp.");
      pendingImages.anime = url;
      updateImagePreview("anime");
      if (status) { status.hidden = true; status.textContent = ""; }
      toast("Đã gợi ý poster: " + (chosen.title || title) + ". Có thể đổi ảnh khác.");
    } catch (e) {
      if (status) { status.textContent = "Không tìm được poster: " + e.message; status.hidden = false; }
    }
  }

  let bulkParsed = { rows: [], errors: [] };

  function parseBulk(kind, text) {
    const rows = [];
    const errors = [];
    String(text || "").split(/\r?\n/).forEach((line, i) => {
      const raw = line.trim();
      if (!raw || raw.startsWith("#")) return;
      const parts = raw.split(/\s*\|\s*/).map((s) => s.trim());
      const [title, second, third, fourth, fifth] = parts;
      if (!title || !(kind === "song" ? fourth : third)) {
        errors.push("Dòng " + (i + 1) + ": thiếu tên hoặc thể loại");
        return;
      }
      if (kind === "song") {
        rows.push({ title, artist: second || "Không rõ", youtube: youtubeId(third || ""), genre: fourth, score: 8, year: null, note: null, image: null });
      } else {
        rows.push({
          title, alt: second || null, genre: third,
          year: fourth ? (Number(fourth) || null) : null,
          episodes: fifth ? (Number(fifth) || null) : null,
          status: "Đã xem", score: 8, note: null, image: null
        });
      }
    });
    const list = kind === "song" ? songs : anime;
    const seen = new Set(list.map((x) => fold(x.title) + "|" + fold(kind === "song" ? x.artist : x.alt || "")));
    rows.forEach((row) => {
      const key = fold(row.title) + "|" + fold(kind === "song" ? row.artist : row.alt || "");
      if (seen.has(key)) row.duplicate = true;
      else seen.add(key);
    });
    return { rows, errors };
  }

  function renderBulkPreview() {
    const kind = $("#bulk-kind");
    const box = $("#bulk-result");
    const addBtn = $("#bulk-add");
    if (!kind || !box || !addBtn) return;
    bulkParsed = parseBulk(kind.value, $("#bulk-input").value);
    const usable = bulkParsed.rows.filter((r) => !r.duplicate).length;
    const lines = [
      ...bulkParsed.errors.map((e) => "⚠ " + e),
      ...bulkParsed.rows.map((r) => r.duplicate ? "↷ " + r.title + " (đã có, sẽ bỏ qua)" : "+ " + r.title)
    ];
    box.textContent = "";
    const list = document.createElement("div");
    list.className = "bulk-list";
    (lines.length ? lines : ["Chưa có dòng nào để thêm."]).forEach((text) => {
      const p = document.createElement("p");
      p.textContent = text;
      list.appendChild(p);
    });
    box.appendChild(list);
    addBtn.disabled = usable === 0;
    addBtn.textContent = usable ? "Thêm " + usable + " mục" : "Thêm các mục";
  }

  async function addBulk() {
    if (!OWNER_MODE) { toast("Đăng nhập chủ web để thêm hàng loạt."); return; }
    const kind = $("#bulk-kind").value;
    const rows = bulkParsed.rows.filter((r) => !r.duplicate);
    if (!rows.length) return;
    const list = kind === "song" ? songs : anime;
    const addedAt = new Date().toISOString();
    const items = rows.map((row, i) => ({
      ...row, id: uid(kind), index: list.length + i, rank: list.length + i + 1, addedAt, updatedAt: addedAt
    }));
    const next = [...list, ...items];
    const collection = kind === "song" ? { songs: next, anime } : { songs, anime: next };
    if (AUTH_ENABLED) {
      currentVersion = new Date().toISOString();
      try {
        await pushRemoteCollection(collection);
      } catch (e) {
        toast("Không thêm được lên web: " + e.message);
        return;
      }
      if (kind === "song") songs = next;
      else anime = next;
      save();
    } else {
      if (!save(collection)) return;
      if (kind === "song") songs = next;
      else anime = next;
    }
    const prefix = kind === "song" ? "song" : "anime";
    state[prefix + "VoteFilter"] = "all";
    state[prefix + "Query"] = "";
    state[prefix + "Genre"] = "Tất cả";
    const search = $("#" + prefix + "-search");
    if (search) search.value = "";
    recordHistory("bulk", kind, items.length + (kind === "song" ? " bài hát" : " anime"));
    renderAll();
    $("#bulk-input").value = "";
    renderBulkPreview();
    toast((AUTH_ENABLED ? "Đã đăng " : "Đã thêm ") + items.length + (kind === "song" ? " bài hát." : " anime."));
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

  function clearFormStatus(type) {
    const box = $("#" + type + "-form-status");
    if (box) { box.hidden = true; box.textContent = ""; }
    document.querySelectorAll("#" + type + "-form .is-invalid").forEach((el) => el.classList.remove("is-invalid"));
  }

  function formError(type, message, fieldId) {
    const box = $("#" + type + "-form-status");
    if (box) { box.textContent = message; box.hidden = false; }
    if (fieldId) {
      const el = $("#" + fieldId);
      if (el) {
        el.classList.add("is-invalid");
        el.focus();
        if (el.scrollIntoView) el.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    }
  }

  function resetForm(type) {
    clearFormStatus(type);
    $("#" + type + "-form").reset();
    $("#" + type + "-edit-id").value = "";
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
    if (!managerVisible) return;
    lastFocused = document.activeElement;
    $("#panel-backdrop").hidden = false;
    document.body.classList.add("panel-open");
    $("#admin-panel").setAttribute("aria-hidden", "false");
    if (!OWNER_MODE) {
      $("#song-form").hidden = true;
      $("#anime-form").hidden = true;
      $("#data-tools").hidden = true;
    } else if (id) openEditor(tab, id);
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

  async function submitForm(type) {
    if (!OWNER_MODE) { toast("Đăng nhập chủ web để thay đổi danh sách."); return; }
    const list = type === "song" ? songs : anime;
    const title = $("#" + type + "-title").value.trim();
    const genre = $("#" + type + "-genre").value.trim();
    clearFormStatus(type);
    if (!title || !genre) {
      const missing = [!title && (type === "song" ? "Tên bài" : "Tên anime"), !genre && "Thể loại"].filter(Boolean).join(" và ");
      formError(type, "Nhớ nhập " + missing + " trước khi thêm nhé.", type + "-" + (!title ? "title" : "genre"));
      return;
    }
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
      addedAt: old ? (old.addedAt || null) : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      title,
      genre,
      score: normalizeScore($("#" + type + "-score").value),
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
    const duplicate = list.find((x) => x.id !== editingId && itemKey(x, type) === itemKey(item, type));
    if (duplicate) {
      formError(type, (type === "song" ? "Bài hát" : "Anime") + " này đã có trong danh sách rồi.", type + "-title");
      return;
    }
    const next = pos >= 0 ? list.map((x, i) => i === pos ? item : x) : [...list, item];
    const collection = type === "song" ? { songs: next, anime } : { songs, anime: next };
    if (AUTH_ENABLED) {
      currentVersion = new Date().toISOString();
      try {
        await pushRemoteCollection(collection);
      } catch (e) {
        formError(type, "Không đăng được lên web: " + e.message + ". Kiểm tra đăng nhập và Rules Firebase.");
        toast("Không đăng được lên web.");
        return;
      }
      if (type === "song") songs = next;
      else anime = next;
      if (!save()) toast("Đã đăng lên web, nhưng máy không lưu được bộ nhớ.");
    } else {
      if (!save(collection)) {
        formError(type, "Không lưu được vào trình duyệt. Xoá bớt ảnh đã thêm hoặc tải file JSON dự phòng rồi thử lại.");
        return;
      }
      if (type === "song") songs = next;
      else anime = next;
    }
    // Luôn đưa mục vừa thêm về danh sách mặc định, kể cả khi đang lọc/tìm kiếm.
    const prefix = type === "song" ? "song" : "anime";
    state[prefix + "VoteFilter"] = "all";
    state[prefix + "Query"] = "";
    state[prefix + "Genre"] = "Tất cả";
    const search = $("#" + prefix + "-search");
    if (search) search.value = "";
    justVoted[type].clear();
    recordHistory(pos >= 0 ? "edit" : "add", type, title);
    renderAll();
    resetForm(type);
    toast(AUTH_ENABLED
      ? "Đã đăng lên web — mọi người thấy ngay."
      : (pos >= 0 ? "Đã lưu thay đổi." : "Đã thêm vào danh sách."));
  }

  async function deleteItem(type, id) {
    if (!OWNER_MODE) { toast("Đăng nhập chủ web để xoá."); return; }
    const list = type === "song" ? songs : anime;
    const item = list.find((x) => x.id === id);
    if (!item || !window.confirm('Xoá "' + item.title + '" khỏi danh sách?')) return;
    const previous = list.map((x, i) => ({ ...x, index: i }));
    const next = previous.filter((x) => x.id !== id);
    const collection = type === "song" ? { songs: next, anime } : { songs, anime: next };
    if (AUTH_ENABLED) {
      currentVersion = new Date().toISOString();
      try {
        await pushRemoteCollection(collection);
      } catch (e) {
        toast("Không xoá được trên web: " + e.message);
        return;
      }
      if (type === "song") songs = next;
      else anime = next;
      save();
    } else {
      if (!save(collection)) return;
      if (type === "song") songs = next;
      else anime = next;
    }
    recordHistory("delete", type, item.title);
    renderAll();
    const undo = async () => {
      const restore = type === "song" ? { songs: previous, anime } : { songs, anime: previous };
      if (AUTH_ENABLED) {
        currentVersion = new Date().toISOString();
        try {
          await pushRemoteCollection(restore);
        } catch (e) {
          toast("Không hoàn tác được trên web: " + e.message);
          return;
        }
        if (type === "song") songs = previous;
        else anime = previous;
        save();
      } else {
        if (!save(restore)) return;
        if (type === "song") songs = previous;
        else anime = previous;
      }
      recordHistory("restore", type, item.title);
      renderAll();
      toast(AUTH_ENABLED ? "Đã khôi phục trên web." : "Đã hoàn tác.");
    };
    toast(AUTH_ENABLED ? "Đã xoá trên web." : "Đã xoá khỏi danh sách.", "Hoàn tác", undo);
  }

  async function toggleAnimeStatus(id) {
    if (!OWNER_MODE) { toast("Đăng nhập chủ web để đổi trạng thái."); return; }
    const item = anime.find((x) => x.id === id);
    if (!item) return;
    const previous = anime.map((x) => ({ ...x }));
    const currentStatus = animeStatus(item);
    const nextStatus = currentStatus === "Chưa xem" ? "Đang xem"
      : currentStatus === "Đang xem" ? "Đã xem" : "Chưa xem";
    const now = new Date().toISOString();
    const next = anime.map((x) => x.id === id ? { ...x, status: nextStatus, updatedAt: now } : x);
    const collection = { songs, anime: next };
    if (AUTH_ENABLED) {
      currentVersion = new Date().toISOString();
      try { await pushRemoteCollection(collection); }
      catch (e) { toast("Không đổi được trên web: " + e.message); return; }
      anime = next;
      save();
    } else {
      if (!save(collection)) { toast("Không lưu được thay đổi trong trình duyệt."); return; }
      anime = next;
    }
    recordHistory("status", "anime", item.title + " → " + nextStatus);
    renderAll();
    const undo = async () => {
      const restore = { songs, anime: previous };
      if (AUTH_ENABLED) {
        currentVersion = new Date().toISOString();
        try { await pushRemoteCollection(restore); }
        catch (e) { toast("Không hoàn tác được trên web: " + e.message); return; }
        anime = previous;
        save();
      } else {
        if (!save(restore)) return;
        anime = previous;
      }
      recordHistory("restore", "anime", item.title);
      renderAll();
      toast(AUTH_ENABLED ? "Đã khôi phục trên web." : "Đã hoàn tác.");
    };
    const messages = {
      "Chưa xem": "Đã đánh dấu chưa xem.",
      "Đang xem": "Đã chuyển sang Đang xem.",
      "Đã xem": "Đã đánh dấu xem xong."
    };
    toast(messages[nextStatus], "Hoàn tác", undo);
  }

  function slugForFile(text, index) {
    return (fold(text || "item").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "item")
      + "-" + index + ".jpg";
  }

  function dataUrlBytes(dataUrl) {
    const match = String(dataUrl).match(/^data:[^;,]*;base64,(.*)$/s);
    if (!match) return new TextEncoder().encode(String(dataUrl));
    const binary = atob(match[1]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function compressDataUrl(dataUrl) {
    return new Promise((resolve) => {
      try {
        const img = new Image();
        img.onload = () => {
          try {
            const maxSide = 1200;
            const scale = Math.min(1, maxSide / Math.max(img.width || 1, img.height || 1));
            const canvas = document.createElement("canvas");
            canvas.width = Math.max(1, Math.round((img.width || 1) * scale));
            canvas.height = Math.max(1, Math.round((img.height || 1) * scale));
            const ctx = canvas.getContext("2d");
            if (!ctx) return resolve(dataUrl);
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            const out = canvas.toDataURL("image/jpeg", 0.82);
            resolve(out && out.length < dataUrl.length ? out : dataUrl);
          } catch (e) { resolve(dataUrl); }
        };
        img.onerror = () => resolve(dataUrl);
        img.src = dataUrl;
      } catch (e) { resolve(dataUrl); }
    });
  }

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function createZip(files) {
    const parts = [];
    const central = [];
    const encoder = new TextEncoder();
    let offset = 0;
    files.forEach((file) => {
      const name = encoder.encode(file.name);
      const data = typeof file.data === "string" ? encoder.encode(file.data) : file.data;
      const crc = crc32(data);
      const local = new Uint8Array(30 + name.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034B50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0, true);
      lv.setUint16(8, 0, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, name.length, true);
      local.set(name, 30);
      parts.push(local, data);

      const record = new Uint8Array(46 + name.length);
      const cv = new DataView(record.buffer);
      cv.setUint32(0, 0x02014B50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0, true);
      cv.setUint16(10, 0, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, name.length, true);
      cv.setUint32(42, offset, true);
      record.set(name, 46);
      central.push(record);
      offset += local.length + data.length;
    });
    const centralSize = central.reduce((sum, part) => sum + part.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054B50, true);
    ev.setUint16(8, central.length, true);
    ev.setUint16(10, central.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end], { type: "application/zip" });
  }

  async function exportUpdatePackage() {
    const toastEl = $("#toast");
    try {
      if (toastEl) toast("Đang đóng gói…");
      const payload = await publicCollection();
      payload.version = new Date().toISOString();
      const files = [];
      const used = new Set();
      for (const [kind, list] of [["song", payload.songs], ["anime", payload.anime]]) {
        for (let i = 0; i < list.length; i++) {
          const item = list[i];
          if (!isDataImage(item.image)) continue;
          const small = await compressDataUrl(item.image);
          const base = slugForFile(item.title || kind, i);
          let name = "assets/covers/" + base;
          if (used.has(name)) name = "assets/covers/" + i + "-" + base;
          used.add(name);
          files.push({ name, data: dataUrlBytes(small) });
          item.image = name;
        }
      }
      const code = "/** Dữ liệu xuất từ trang web Soricia. Thay nội dung data/data.js bằng file này. */\n"
        + "window.SITE_DATA = " + JSON.stringify(payload, null, 2) + ";\n";
      files.unshift({ name: "data.js", data: code });
      files.push({
        name: "README.txt",
        data: "Gói cap nhat Soricia\n\n"
          + "1. Thay data/data.js bang file data.js trong goi nay.\n"
          + "2. Chep cac file trong assets/covers/ vao repo (khong can doi ten).\n"
          + "3. Commit va day len main de GitHub Pages tu dong cap nhat.\n\n"
          + "Anh duoc nen JPEG toi da 1200px de giam dung luong.\n"
      });
      const blob = createZip(files);
      const day = new Date().toISOString().slice(0, 10);
      downloadFile(blob, "soricia-update-" + day + ".zip", "application/zip");
      toast("Đã tải gói cập nhật (" + files.length + " file).");
    } catch (e) {
      console.warn("Không đóng gói được:", e);
      toast("Không đóng gói được: " + e.message);
    }
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
    if (AUTH_ENABLED) {
      $("#auth-signin").addEventListener("click", async () => {
        const status = $("#auth-status");
        const email = $("#auth-email").value.trim();
        const password = $("#auth-password").value;
        if (!email || !password) {
          status.textContent = "Nhập cả email và mật khẩu nhé.";
          status.hidden = false;
          return;
        }
        status.hidden = true;
        try {
          await signInOwner(email, password);
          $("#auth-password").value = "";
          toast("Đã đăng nhập chủ web.");
        } catch (e) {
          status.textContent = "Đăng nhập không được: " + e.message;
          status.hidden = false;
        }
      });
      $("#auth-signout").addEventListener("click", signOutOwner);
      $("#auth-publish").addEventListener("click", async () => {
        currentVersion = new Date().toISOString();
        try {
          await pushRemoteCollection();
          save();
          recordHistory("publish", "data", "Firebase");
          toast("Đã đăng danh sách hiện tại lên web.");
        } catch (e) {
          toast("Không đăng được: " + e.message);
        }
      });
    }
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
      const statusToggle = e.target.closest("[data-status-toggle]");
      if (statusToggle) { toggleAnimeStatus(statusToggle.dataset.statusToggle); return; }
      const share = e.target.closest("[data-share]");
      if (share) { copyShareLink(share.dataset.share, share.dataset.shareKey); return; }
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
      $("#" + type + "-submit").addEventListener("click", (e) => { e.preventDefault(); submitForm(type); });
      $("#" + type + "-form").addEventListener("input", (e) => {
        if (e.target.classList.contains("is-invalid")) e.target.classList.remove("is-invalid");
        const box = $("#" + type + "-form-status");
        if (box && !box.hidden) box.hidden = true;
      });
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
    const findPoster = $("#anime-find-poster");
    if (findPoster) findPoster.addEventListener("click", findAnimePoster);
    $("#bulk-preview").addEventListener("click", renderBulkPreview);
    $("#bulk-kind").addEventListener("change", renderBulkPreview);
    $("#bulk-add").addEventListener("click", addBulk);

    $("#export-json").addEventListener("click", async () => {
      const payload = await publicCollection();
      downloadFile(JSON.stringify(payload, null, 2), "soricia-data.json", "application/json");
      toast("Đã tải file JSON.");
    });

    $("#export-js").addEventListener("click", async () => {
      const payload = await publicCollection();
      payload.version = new Date().toISOString();
      const code = "/** Dữ liệu xuất từ trang web Soricia. Thay nội dung data/data.js bằng file này. */\nwindow.SITE_DATA = " + JSON.stringify(payload, null, 2) + ";\n";
      downloadFile(code, "data.js", "text/javascript");
      toast("Đã tải data.js.");
    });

    $("#export-package").addEventListener("click", exportUpdatePackage);
    $("#health-check").addEventListener("click", runHealthCheck);
    $("#cleanup-images").addEventListener("click", cleanupUnusedImages);
    $("#history-clear").addEventListener("click", () => {
      if (!OWNER_MODE) return;
      if (!window.confirm("Xoá nhật ký chủ web trên thiết bị này?")) return;
      try { localStorage.removeItem(HISTORY_KEY); } catch (e) { /* ignore */ }
      renderHistory();
      toast("Đã xoá nhật ký.");
    });

    const dailyPick = $("#daily-pick");
    if (dailyPick) dailyPick.addEventListener("click", () => {
      if (!dailySong) return;
      if (dailySong.youtube) {
        openPlayer(dailySong.youtube, dailySong.title);
      } else {
        window.location.hash = "#item=song:" + encodeURIComponent(voteKey(dailySong, "song"));
        applyDeepLink();
      }
    });
    const dailyShare = $("#daily-share");
    if (dailyShare) dailyShare.addEventListener("click", async () => {
      if (!dailySong) return;
      const url = window.location.origin + window.location.pathname
        + "?daily=" + encodeURIComponent(dailySeed())
        + "#item=song:" + encodeURIComponent(voteKey(dailySong, "song"));
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(url);
        else {
          const input = document.createElement("textarea");
          input.value = url; document.body.appendChild(input); input.select();
          document.execCommand("copy"); input.remove();
        }
        toast("Đã copy link bài hát hôm nay.");
      } catch (e) { window.prompt("Copy link này:", url); }
    });

    const remoteBanner = $("#remote-banner");
    if (remoteBanner) {
      $("#remote-dismiss").addEventListener("click", () => {
        pendingRemoteVersion = null;
        remoteBanner.hidden = true;
      });
      $("#remote-reload").addEventListener("click", async () => {
        if (!window.confirm("Tải bản dữ liệu mới? Mọi thay đổi chưa lưu trong bảng quản lý sẽ mất.")) return;
        remoteBanner.hidden = true;
        pendingRemoteVersion = null;
        await pullRemoteCollection();
        applyDeepLink();
        toast("Đã tải dữ liệu mới.");
      });
    }

    $("#import-json").addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const parsed = JSON.parse(reader.result);
          currentVersion = parsed.version || new Date().toISOString();
          songs = normalize(parsed.songs, "song");
          anime = normalize(parsed.anime, "anime");
          await stashDataImages();
          await hydrateImageCache();
          save(); renderAll();
          recordHistory("import", "data", "từ file JSON");
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
        recordHistory("restore", "data", "bản sao lưu");
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
      recordHistory("reset", "data", "dữ liệu gốc");
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
  async function init() {
    if (initialized) return;
    initialized = true;
    initTheme();
    applyOwnerUi();
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
    await hydrateImageCache();
    renderAll();
    applyDeepLink();
    loadRatings();
    if (AUTH_ENABLED) {
      pullRemoteCollection();
      window.setInterval(checkRemoteUpdates, 30000);
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) checkRemoteUpdates();
      });
    }
    initReveal();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
