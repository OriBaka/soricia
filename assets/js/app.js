/* Soricia — rendering, filters and small interactions. No build step needed. */
(function () {
  "use strict";

  const data = window.SITE_DATA || { songs: [], anime: [] };
  const songs = (data.songs || []).map((item, i) => ({ ...item, index: i, rank: item.rank || i + 1 }));
  const anime = (data.anime || []).map((item, i) => ({ ...item, index: i, rank: item.rank || i + 1 }));

  const state = {
    songGenre: "Tất cả",
    songQuery: "",
    songSort: "score",
    animeGenre: "Tất cả",
    animeQuery: "",
    animeSort: "score"
  };

  const $ = (selector) => document.querySelector(selector);
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[ch]);
  const fold = (value) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const fmt = (score) => Number(score || 0).toFixed(1);

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

  function sortItems(items, mode) {
    const copy = [...items];
    if (mode === "rank") return copy.sort((a, b) => a.rank - b.rank);
    if (mode === "title") return copy.sort((a, b) => String(a.title).localeCompare(String(b.title), "vi"));
    if (mode === "year") return copy.sort((a, b) => (b.year || 0) - (a.year || 0));
    return copy.sort((a, b) => (b.score || 0) - (a.score || 0) || a.index - b.index);
  }

  function filterItems(items, genre, query) {
    const q = fold(query).trim();
    return items.filter((item) => {
      const genreOk = genre === "Tất cả" || item.genre === genre;
      if (!genreOk) return false;
      if (!q) return true;
      return fold([item.title, item.artist, item.genre, item.alt, item.note].filter(Boolean).join(" ")).includes(q);
    });
  }

  function uniqueGenres(items) {
    return [...new Set(items.map((item) => item.genre).filter(Boolean))]
      .sort((a, b) => String(a).localeCompare(String(b), "vi"));
  }

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

  function renderSongs() {
    const list = $("#music-list");
    const items = sortItems(filterItems(songs, state.songGenre, state.songQuery), state.songSort);
    const topScore = songs.length ? Math.max(...songs.map((s) => s.score || 0)) : 0;

    list.innerHTML = items.map((song, i) => `
      <li class="song${(song.score || 0) >= topScore - 0.05 ? " is-top" : ""}">
        <span class="song-rank" aria-label="Vị trí ${i + 1}">${String(i + 1).padStart(2, "0")}</span>
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
        </div>
        <div class="song-score"><strong>${fmt(song.score)}</strong><small>/ 10 điểm</small></div>
      </li>
    `).join("");

    $("#music-count").textContent = String(items.length);
    const empty = $("#music-empty");
    empty.hidden = items.length > 0;
    empty.textContent = songs.length === 0
      ? "Chưa có bài hát nào trong danh sách. Gửi tên bài để mình thêm nhé."
      : "Không tìm thấy bài hát phù hợp. Thử đổi từ khoá hoặc thể loại nhé.";
  }

  function renderAnime() {
    const list = $("#anime-list");
    const items = sortItems(filterItems(anime, state.animeGenre, state.animeQuery), state.animeSort);

    list.innerHTML = items.map((show, i) => {
      const [from, to] = paletteFor(show.title);
      const stars = Math.round((show.score || 0) / 2);
      const watching = fold(show.status).includes("dang");
      return `
        <article class="anime-card">
          <div class="anime-cover" style="--c1:${from};--c2:${to}">
            <span class="status-tag${watching ? " is-watching" : ""}">${esc(show.status || "Đã xem")}</span>
            <span class="anime-cover-rank">#${String(i + 1).padStart(2, "0")}</span>
            <span class="anime-initials">${esc(initialsFor(show.title))}</span>
          </div>
          <div class="anime-body">
            <h3 class="anime-title">${esc(show.title)}</h3>
            ${show.alt ? `<p class="anime-sub">${esc(show.alt)}</p>` : ""}
            <p class="anime-sub">${esc(show.genre)} · ${show.year ? esc(show.year) + " · " : ""}${show.episodes ? esc(show.episodes) + " tập" : ""}</p>
            ${show.note ? `<p class="anime-note">${esc(show.note)}</p>` : ""}
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
      ? "Chưa có anime nào trong danh sách. Gửi tên phim để mình thêm nhé."
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
    document.querySelector('[data-stat="genres"]').textContent = uniqueGenres(songs).length;
    document.querySelector('[data-stat="anime"]').textContent = anime.length;
    document.querySelector('[data-stat="avg"]').textContent = allScores.length ? fmt(avg) : "—";
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

  function init() {
    initTheme();
    const year = new Date().getFullYear();
    $("#hero-year").textContent = year;
    $("#footer-year").textContent = year;

    makeChips($("#music-filters"), uniqueGenres(songs), state.songGenre, (genre) => {
      state.songGenre = genre;
      renderSongs();
    });
    makeChips($("#anime-filters"), uniqueGenres(anime), state.animeGenre, (genre) => {
      state.animeGenre = genre;
      renderAnime();
    });

    $("#music-search").addEventListener("input", (e) => { state.songQuery = e.target.value; renderSongs(); });
    $("#anime-search").addEventListener("input", (e) => { state.animeQuery = e.target.value; renderAnime(); });
    $("#music-sort").addEventListener("change", (e) => { state.songSort = e.target.value; renderSongs(); });
    $("#anime-sort").addEventListener("change", (e) => { state.animeSort = e.target.value; renderAnime(); });

    renderSongs();
    renderAnime();
    fillHeroAndStats();
    initReveal();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
