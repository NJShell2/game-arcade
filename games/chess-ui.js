/* Chess UI. Requires chess-logic.js + js/difficulty.js. No ES modules. */
(function () {
"use strict";
var GAME_ID = "chess";
var D = window.ArcadeDifficulty;
var C = window.Chess;

var GLYPH = {
  w: { k: "\u2654", q: "\u2655", r: "\u2656", b: "\u2657", n: "\u2658", p: "\u2659" },
  b: { k: "\u265A", q: "\u265B", r: "\u265C", b: "\u265D", n: "\u265E", p: "\u265F" }
};
var REASONS = {
  "checkmate": "Checkmate",
  "stalemate": "Stalemate",
  "fifty-move": "Draw by the fifty-move rule",
  "threefold": "Draw by threefold repetition",
  "insufficient material": "Draw \u2014 insufficient material",
  "resignation": "Resignation"
};

var state, humanColor, flipped, selected, legalCache, lastMove, history;
var gameOver, thinking, levelAtStart, recorded, pendingPromo;

var boardEl = document.getElementById("board");
var statusEl = document.getElementById("status");
var movesEl = document.getElementById("moves");
var capturedEl = document.getElementById("captured");
var sideWBtn = document.getElementById("side-w");
var sideBBtn = document.getElementById("side-b");
var promoModal = document.getElementById("promo-modal");
var promoBtns = document.getElementById("promo-btns");

function setStatus(html) { statusEl.innerHTML = html; }

function newGame() {
  state = C.newGame();
  humanColor = sideWBtn.classList.contains("active") ? "w" : "b";
  flipped = (humanColor === "b");
  selected = null;
  lastMove = null;
  history = [];
  gameOver = false;
  thinking = false;
  recorded = false;
  pendingPromo = null;
  levelAtStart = D.getLevel(GAME_ID);
  refreshLegal();
  render();
  hidePromo();
  if (state.turn !== humanColor) {
    thinking = true;
    setStatus("Computer (" + sideName(state.turn) + ") is thinking\u2026");
    setTimeout(aiTurn, 60);
  } else {
    setStatus("Your move (" + sideName(humanColor) + ").");
  }
}

function sideName(c) { return c === "w" ? "White" : "Black"; }

function refreshLegal() { legalCache = C.legalMoves(state); }

function legalFrom(from) {
  var out = [];
  for (var i = 0; i < legalCache.length; i++) {
    if (legalCache[i].from === from) out.push(legalCache[i]);
  }
  return out;
}

/* display row/col -> square index, honoring orientation */
function displaySq(dRow, dCol) {
  var rank = flipped ? dRow : 7 - dRow;
  var file = flipped ? 7 - dCol : dCol;
  return rank * 8 + file;
}

function isLastMoveSq(i) {
  return lastMove && (i === lastMove.from || i === lastMove.to);
}

function kingInCheckSq() {
  if (!C.inCheck(state, state.turn)) return -1;
  var b = state.board;
  for (var i = 0; i < 64; i++) {
    var p = b[i];
    if (p && p.t === "k" && p.c === state.turn) return i;
  }
  return -1;
}

function render() {
  refreshLegal();
  var checkSq = kingInCheckSq();
  var targets = {};
  if (selected !== null) {
    var lm = legalFrom(selected);
    for (var i = 0; i < lm.length; i++) {
      targets[lm[i].to] = state.board[lm[i].to] ? "cap" : "dot";
    }
  }
  boardEl.innerHTML = "";
  for (var dr = 0; dr < 8; dr++) {
    for (var dc = 0; dc < 8; dc++) {
      (function (dr, dc) {
        var i = displaySq(dr, dc);
        var r = i >> 3, f = i & 7;
        var cell = document.createElement("button");
        cell.type = "button";
        cell.className = "sq " + (((r + f) % 2 === 0) ? "dark" : "light");
        cell.setAttribute("data-sq", i);
        cell.setAttribute("aria-label", C.squareName(i));
        var p = state.board[i];
        if (p) {
          var sp = document.createElement("span");
          sp.className = p.c === "w" ? "pc-w" : "pc-b";
          sp.textContent = GLYPH[p.c][p.t];
          cell.appendChild(sp);
        }
        if (i === selected) cell.classList.add("sel");
        if (isLastMoveSq(i)) cell.classList.add("last");
        if (i === checkSq) cell.classList.add("check");
        if (targets[i] === "dot") {
          var dot = document.createElement("span");
          dot.className = "dot";
          cell.appendChild(dot);
        } else if (targets[i] === "cap") {
          var ring = document.createElement("span");
          ring.className = "cap-ring";
          cell.appendChild(ring);
        }
        if (dc === 0) {
          var rn = document.createElement("span");
          rn.className = "coord rank";
          rn.textContent = String(r + 1);
          cell.appendChild(rn);
        }
        if (dr === 7) {
          var fl = document.createElement("span");
          fl.className = "coord file";
          fl.textContent = "abcdefgh".charAt(f);
          cell.appendChild(fl);
        }
        cell.addEventListener("click", function () { onSquare(i); });
        boardEl.appendChild(cell);
      })(dr, dc);
    }
  }
  renderMoves();
  renderCaptured();
}

function renderMoves() {
  movesEl.innerHTML = "";
  for (var i = 0; i < history.length; i += 2) {
    var row = document.createElement("div");
    row.className = "mrow";
    var num = document.createElement("span");
    num.className = "mnum";
    num.textContent = (i / 2 + 1) + ".";
    var w = document.createElement("span");
    w.textContent = history[i];
    var b = document.createElement("span");
    b.textContent = history[i + 1] || "";
    row.appendChild(num); row.appendChild(w); row.appendChild(b);
    movesEl.appendChild(row);
  }
  movesEl.scrollTop = movesEl.scrollHeight;
}

var MAT = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

function renderCaptured() {
  var start = { p: 8, n: 2, b: 2, r: 2, q: 1 };
  var cur = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };
  var matW = 0, matB = 0;
  for (var i = 0; i < 64; i++) {
    var p = state.board[i];
    if (p && p.t !== "k") {
      cur[p.c][p.t]++;
      if (p.c === "w") matW += MAT[p.t]; else matB += MAT[p.t];
    }
  }
  var order = ["q", "r", "b", "n", "p"];
  function taken(byColor) {
    // pieces of the enemy color captured BY byColor
    var enemy = byColor === "w" ? "b" : "w";
    var out = "";
    for (var k = 0; k < order.length; k++) {
      var t = order[k];
      var n = start[t] - cur[enemy][t];
      for (var j = 0; j < n; j++) out += GLYPH[enemy][t];
    }
    return out || "\u2014";
  }
  var diff = Math.round((matW - matB) / 100);
  var diffTxt = "";
  if (diff !== 0) {
    var aheadHuman = (humanColor === "w") === (diff > 0);
    diffTxt = " <span class='matdiff'>(" + (aheadHuman ? "+" : "") +
      (humanColor === "w" ? diff : -diff) + " for you)</span>";
  }
  capturedEl.innerHTML =
    "<div class='cap-row'><span class='cap-label'>You captured:</span> <span class='cap-pieces'>" +
    taken(humanColor) + "</span></div>" +
    "<div class='cap-row'><span class='cap-label'>Computer captured:</span> <span class='cap-pieces'>" +
    taken(humanColor === "w" ? "b" : "w") + "</span>" + diffTxt + "</div>";
}

function onSquare(i) {
  if (gameOver || thinking || state.turn !== humanColor) return;
  var p = state.board[i];
  if (selected !== null && i !== selected) {
    var moves = legalFrom(selected).filter(function (m) { return m.to === i; });
    if (moves.length) {
      var needsPromo = moves.some(function (m) { return !!m.promo; });
      if (needsPromo) {
        pendingPromo = { from: selected, to: i };
        showPromo();
        return;
      }
      doHumanMove(selected, i, null);
      return;
    }
  }
  if (p && p.c === humanColor) {
    selected = (selected === i) ? null : i;
  } else {
    selected = null;
  }
  render();
}

function doHumanMove(from, to, promo) {
  if (gameOver || state.turn !== humanColor) return;
  var m = null;
  for (var i = 0; i < legalCache.length; i++) {
    var x = legalCache[i];
    if (x.from === from && x.to === to && (x.promo || null) === (promo || null)) { m = x; break; }
  }
  if (!m) return;
  selected = null;
  pushMove(m);
  afterMove();
}

function pushMove(m) {
  var san = C.moveToSAN(state, m);
  lastMove = { from: m.from, to: m.to };
  state = C.applyMove(state, m);
  history.push(san);
}

function aiTurn() {
  if (gameOver) { thinking = false; return; }
  var m = C.aiMove(state, levelAtStart);
  thinking = false;
  if (!m) { afterMove(); return; }
  pushMove(m);
  afterMove();
}

function afterMove() {
  render();
  var res = C.result(state);
  if (res) return endGame(res);
  if (state.turn === humanColor) {
    var chk = C.inCheck(state, state.turn) ? " \u2014 check!" : "";
    setStatus("Your move (" + sideName(humanColor) + ")." + chk);
  } else {
    thinking = true;
    setStatus("Computer (" + sideName(state.turn) + ") is thinking\u2026");
    render();
    setTimeout(aiTurn, 60);
  }
}

function endGame(res) {
  if (recorded) return;
  recorded = true;
  gameOver = true;
  thinking = false;
  hidePromo();
  render();
  var humanResult, msg;
  if (res.reason === "resignation") {
    humanResult = "loss";
    msg = '<span class="lose">You resigned.</span> The computer takes this one.';
  } else if (res.winner === null) {
    humanResult = "draw";
    msg = '<span class="draw">Draw.</span> ' + (REASONS[res.reason] || "");
  } else if (res.winner === humanColor) {
    humanResult = "win";
    msg = '<span class="win">Checkmate \u2014 you win!</span> \u{1F389}';
  } else {
    humanResult = "loss";
    msg = '<span class="lose">Checkmate \u2014 computer wins.</span> Better luck next time.';
  }
  setStatus(msg + ' <button class="btn" id="again" style="margin-left:10px">Play again</button>');
  document.getElementById("again").addEventListener("click", newGame);
  var r = D.recordResult(GAME_ID, humanResult, levelAtStart);
  D.toast(r.message);
  D.renderBar(document.getElementById("difficulty-bar"), GAME_ID);
}

function showPromo() {
  promoBtns.innerHTML = "";
  var pcs = ["q", "r", "b", "n"];
  for (var i = 0; i < pcs.length; i++) {
    (function (t) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "promo-btn " + (humanColor === "w" ? "pc-w" : "pc-b");
      btn.textContent = GLYPH[humanColor][t];
      btn.setAttribute("aria-label", "Promote to " + t);
      btn.addEventListener("click", function () {
        hidePromo();
        if (pendingPromo) {
          var pp = pendingPromo;
          pendingPromo = null;
          doHumanMove(pp.from, pp.to, t);
        }
      });
      promoBtns.appendChild(btn);
    })(pcs[i]);
  }
  promoModal.hidden = false;
}

function hidePromo() {
  pendingPromo = null;
  promoModal.hidden = true;
}

document.getElementById("new-game").addEventListener("click", newGame);
document.getElementById("flip-board").addEventListener("click", function () {
  flipped = !flipped;
  render();
});
document.getElementById("resign").addEventListener("click", function () {
  if (gameOver || recorded) return;
  endGame({ over: true, winner: humanColor === "w" ? "b" : "w", reason: "resignation" });
});
sideWBtn.addEventListener("click", function () {
  sideWBtn.classList.add("active"); sideBBtn.classList.remove("active"); newGame();
});
sideBBtn.addEventListener("click", function () {
  sideBBtn.classList.add("active"); sideWBtn.classList.remove("active"); newGame();
});
promoModal.addEventListener("click", function (e) {
  if (e.target === promoModal) hidePromo();
});

D.renderBar(document.getElementById("difficulty-bar"), GAME_ID);
newGame();
})();
