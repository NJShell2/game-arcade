/* Neon Arcade — adaptive difficulty system.
 * One global default level; each game adapts its own level independently.
 * Win  -> bump up one level (max Impossible).
 * Lose twice in a row -> drop one level (min Beginner).
 * Draw -> no change, loss streak resets.
 * Stored in localStorage under "neon-arcade.v1".
 * Plain script, no modules: works from file:// and GitHub Pages.
 */
(function () {
  "use strict";

  var LEVELS = ["Beginner", "Easy", "Medium", "Hard", "Impossible"];
  var STORE_KEY = "neon-arcade.v1";

  function clamp(l) {
    l = parseInt(l, 10);
    if (isNaN(l)) l = 1;
    return Math.max(0, Math.min(LEVELS.length - 1, l));
  }

  function blankState() { return { defaultLevel: 1, games: {} }; }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return blankState();
      var s = JSON.parse(raw);
      if (!s || typeof s !== "object") return blankState();
      if (!Number.isInteger(s.defaultLevel)) s.defaultLevel = 1;
      s.defaultLevel = clamp(s.defaultLevel);
      if (!s.games || typeof s.games !== "object") s.games = {};
      return s;
    } catch (e) {
      return blankState();
    }
  }

  var state = loadState();

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
  }

  function gameRec(id) {
    var g = state.games[id];
    if (!g) {
      g = state.games[id] = { level: null, lossStreak: 0, wins: 0, losses: 0, draws: 0 };
      save();
    }
    return g;
  }

  /** Current level for a game (gameId null/undefined => global default). */
  function getLevel(gameId) {
    if (gameId === null || gameId === undefined) return clamp(state.defaultLevel);
    var g = gameRec(gameId);
    if (g.level === null || g.level === undefined) {
      g.level = clamp(state.defaultLevel);
      save();
    }
    return clamp(g.level);
  }

  /** Manual override. Pass gameId null to change the global default. Resets loss streak. */
  function setLevel(gameId, level) {
    level = clamp(level);
    if (gameId === null || gameId === undefined) {
      state.defaultLevel = level;
    } else {
      var g = gameRec(gameId);
      g.level = level;
      g.lossStreak = 0;
    }
    save();
  }

  /**
   * Record a finished game from the HUMAN's perspective.
   * @param {string} gameId
   * @param {"win"|"loss"|"draw"} result
   * @param {number} [playedLevel] level the game was actually played at (defaults to current)
   * @returns {{changed:boolean, level:number, message:string}}
   */
  function recordResult(gameId, result, playedLevel) {
    var g = gameRec(gameId);
    var level = (playedLevel === undefined || playedLevel === null) ? getLevel(gameId) : clamp(playedLevel);
    var changed = false, message = "";
    if (result === "win") {
      g.wins += 1;
      g.lossStreak = 0;
      if (level < LEVELS.length - 1) {
        g.level = level + 1;
        changed = true;
        message = "Nice win! Difficulty bumped up to " + LEVELS[g.level] + ".";
      } else {
        g.level = level;
        message = "You beat Impossible. Legendary.";
      }
    } else if (result === "loss") {
      g.losses += 1;
      g.lossStreak += 1;
      if (g.lossStreak >= 2 && level > 0) {
        g.level = level - 1;
        g.lossStreak = 0;
        changed = true;
        message = "Two tough losses in a row — easing down to " + LEVELS[g.level] + " for the next round.";
      } else {
        g.level = level;
        if (g.lossStreak === 1) message = "Tough loss. One more and the difficulty eases off.";
      }
    } else {
      g.draws += 1;
      g.lossStreak = 0;
      g.level = level;
      message = "Draw — difficulty stays at " + LEVELS[level] + ".";
    }
    save();
    return { changed: changed, level: clamp(g.level), message: message };
  }

  function getStats(gameId) {
    var g = gameRec(gameId);
    return { wins: g.wins | 0, losses: g.losses | 0, draws: g.draws | 0, level: getLevel(gameId), lossStreak: g.lossStreak | 0 };
  }

  function resetAll() {
    state = blankState();
    save();
  }

  /** Render the 5-button difficulty row into container for gameId (null => default). */
  function renderBar(container, gameId) {
    if (!container) return;
    container.classList.add("diff-bar");
    var cur = getLevel(gameId);
    container.innerHTML = "";
    var label = document.createElement("span");
    label.className = "diff-label";
    label.textContent = "Difficulty:";
    container.appendChild(label);
    LEVELS.forEach(function (name, i) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "diff-btn" + (i === cur ? " active" : "") + " diff-" + i;
      b.textContent = name;
      b.setAttribute("aria-pressed", i === cur ? "true" : "false");
      b.title = gameId ? "Set " + name + " for this game" : "Set default " + name + " for new games";
      b.addEventListener("click", function () {
        setLevel(gameId, i);
        renderBar(container, gameId); // repaint
      });
      container.appendChild(b);
    });
  }

  /** Floating toast notification. */
  function toast(msg, ms) {
    if (!msg) return;
    var t = document.createElement("div");
    t.className = "toast";
    t.textContent = msg;
    document.body.appendChild(t);
    // force reflow so the transition runs
    void t.offsetWidth;
    t.classList.add("show");
    setTimeout(function () {
      t.classList.remove("show");
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 400);
    }, ms || 3500);
  }

  window.ArcadeDifficulty = {
    LEVELS: LEVELS,
    getLevel: getLevel,
    setLevel: setLevel,
    recordResult: recordResult,
    getStats: getStats,
    renderBar: renderBar,
    toast: toast,
    resetAll: resetAll
  };
})();
