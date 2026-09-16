/* Checkers UI. Requires checkers-logic.js + js/difficulty.js */
(function () {
  "use strict";
  var GAME_ID = "checkers";
  var D = window.ArcadeDifficulty;
  var C = window.Checkers;
  var HUMAN = "r", AI = "w";

  var state, levelAtStart, gameOver, recorded;
  var selected = null;   // [r,c] of selected human piece
  var selMoves = [];     // legal moves from `selected`
  var seq = null;        // active multi-jump: { moves, prefix:[[r,c]], board:[64], pos:[r,c] }

  var boardEl = document.getElementById("board");
  var statusEl = document.getElementById("status");
  var capEl = document.getElementById("captured");
  var logEl = document.getElementById("move-log");

  function setStatus(html) { statusEl.innerHTML = html; }
  function sqName(rc) { return "(" + rc[0] + "," + rc[1] + ")"; }

  function newGame() {
    state = C.newGame();
    gameOver = false;
    recorded = false;
    selected = null;
    selMoves = [];
    seq = null;
    levelAtStart = D.getLevel(GAME_ID);
    logEl.innerHTML = "";
    render();
    setStatus('Your move — <b style="color:var(--red)">Red</b>. Click one of your pieces.');
  }

  /** Board shown on screen: mid-jump working copy while a sequence is active. */
  function viewBoard() { return seq ? seq.board : state.board; }

  /** Destination squares currently highlighted. */
  function destSet() {
    var dests = {};
    if (gameOver) return dests;
    if (seq) {
      var n = seq.prefix.length;
      seq.moves.forEach(function (m) {
        var l = m.path[n];
        dests[l[0] + "," + l[1]] = true;
      });
    } else if (selected) {
      selMoves.forEach(function (m) {
        var l = m.path[0];
        dests[l[0] + "," + l[1]] = true;
      });
    }
    return dests;
  }

  function render() {
    var board = viewBoard();
    var dests = destSet();
    boardEl.innerHTML = "";
    for (var r = 0; r < 8; r++) {
      for (var c = 0; c < 8; c++) {
        (function (r, c) {
          var cell = document.createElement("div");
          cell.className = "sq " + (((r + c) & 1) ? "dark" : "light");
          cell.dataset.r = r;
          cell.dataset.c = c;
          var p = board[r * 8 + c];
          if (p) {
            var pc = document.createElement("div");
            pc.className = "piece " + (p.c === "r" ? "red" : "white") + (p.k ? " king" : "");
            if (p.k) pc.textContent = "♛";
            cell.appendChild(pc);
          }
          var key = r + "," + c;
          if (dests[key]) cell.classList.add("dest");
          if ((selected && selected[0] === r && selected[1] === c) ||
              (seq && seq.pos[0] === r && seq.pos[1] === c)) {
            cell.classList.add("selected");
          }
          cell.addEventListener("click", function () { onSquare(r, c); });
          boardEl.appendChild(cell);
        })(r, c);
      }
    }
    renderCaptured();
  }

  function renderCaptured() {
    var reds = 0, whites = 0;
    for (var i = 0; i < 64; i++) {
      var p = state.board[i];
      if (p) { if (p.c === "r") reds++; else whites++; }
    }
    capEl.innerHTML =
      'You captured: <b style="color:var(--cyan)">' + (12 - whites) + '</b>' +
      ' &nbsp;•&nbsp; Computer captured: <b style="color:var(--magenta)">' + (12 - reds) + '</b>';
  }

  function logMove(color, move) {
    var cells = [move.from].concat(move.path).map(sqName).join("→");
    var note = "";
    if (move.captures.length) note += " ×" + move.captures.length;
    if (move.promotes) note += " ♛";
    var div = document.createElement("div");
    div.className = "log-line " + (color === "r" ? "lr" : "lw");
    div.textContent = (color === "r" ? "Red: " : "White: ") + cells + note;
    logEl.appendChild(div);
    while (logEl.children.length > 12) logEl.removeChild(logEl.firstChild);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function prefixMatches(path, prefix) {
    if (path.length < prefix.length) return false;
    for (var i = 0; i < prefix.length; i++) {
      if (path[i][0] !== prefix[i][0] || path[i][1] !== prefix[i][1]) return false;
    }
    return true;
  }

  function onSquare(r, c) {
    if (gameOver || state.turn !== HUMAN) return;

    if (seq) {
      if (destsHas(r, c)) { seqStep(r, c); return; }
      // clicking elsewhere cancels the in-progress jump choice
      seq = null; selected = null; selMoves = [];
      render();
      setStatus('Your move — <b style="color:var(--red)">Red</b>. Click one of your pieces.');
      return;
    }

    var p = state.board[r * 8 + c];
    if (destsHas(r, c) && selected) { beginHumanMove(r, c); return; }

    if (p && p.c === HUMAN) {
      var moves = C.genMoves(state, HUMAN).filter(function (m) {
        return m.from[0] === r && m.from[1] === c;
      });
      if (!moves.length) {
        setStatus("That piece has no legal move right now.");
        return;
      }
      selected = [r, c];
      selMoves = moves;
      render();
      if (moves[0].captures.length) {
        setStatus("Capture is <b>mandatory</b> — choose a highlighted landing square.");
      } else {
        setStatus("Piece selected — choose a highlighted square.");
      }
      return;
    }

    selected = null; selMoves = [];
    render();
  }

  function destsHas(r, c) { return !!destSet()[r + "," + c]; }

  /** Human chose landing (r,c) for the selected piece: single step or start of a sequence. */
  function beginHumanMove(r, c) {
    var first = selMoves.filter(function (m) {
      return m.path[0][0] === r && m.path[0][1] === c;
    });
    if (!first.length) return;
    if (first.length === 1 && first[0].path.length === 1) {
      commitHuman(first[0]);
      return;
    }
    // Multi-jump (or ambiguous first landing): walk it step by step.
    var b = state.board.slice();
    seq = { moves: first, prefix: [], board: b, pos: selected.slice() };
    selected = null; selMoves = [];
    setStatus("Jump taken — <b>you must keep jumping</b> with this piece. Choose the next highlighted square.");
    seqStep(r, c);
  }

  /** Apply one visual jump step of the active sequence; commit when complete. */
  function seqStep(r, c) {
    var prefix = seq.prefix.concat([[r, c]]);
    var cont = seq.moves.filter(function (m) { return prefixMatches(m.path, prefix); });
    if (!cont.length) return;
    var stepIdx = seq.prefix.length;
    var cap = cont[0].captures[stepIdx];
    var b = seq.board;
    b[cap[0] * 8 + cap[1]] = null;
    var piece = b[seq.pos[0] * 8 + seq.pos[1]];
    b[seq.pos[0] * 8 + seq.pos[1]] = null;
    b[r * 8 + c] = piece;
    seq.pos = [r, c];
    seq.prefix = prefix;
    seq.moves = cont;

    if (cont.length === 1 && cont[0].path.length === prefix.length) {
      var full = cont[0];
      seq = null;
      commitHuman(full);
    } else {
      render();
      setStatus("Keep jumping — choose the next highlighted square.");
    }
  }

  function commitHuman(move) {
    selected = null; selMoves = [];
    state = C.applyMove(state, move);
    logMove(HUMAN, move);
    afterMove();
  }

  function afterMove() {
    render();
    var w = C.winner(state);
    if (w) { endGame(w); return; }
    if (state.turn === HUMAN) {
      setStatus('Your move — <b style="color:var(--red)">Red</b>.');
    } else {
      setStatus("Computer (White) is thinking…");
      setTimeout(aiTurn, 60); // let the "thinking" paint before the search
    }
  }

  function aiTurn() {
    if (gameOver) return;
    var m = C.aiMove(state, levelAtStart);
    if (!m) { endGame(state.turn === HUMAN ? AI : HUMAN); return; }
    state = C.applyMove(state, m);
    logMove(AI, m);
    afterMove();
  }

  function endGame(w) {
    gameOver = true;
    selected = null; selMoves = []; seq = null;
    render();
    var result, msg;
    if (w === "draw") {
      result = "draw";
      msg = '<span class="draw">Draw!</span> Nobody wins this one.';
    } else if (w === HUMAN) {
      result = "win";
      msg = '<span class="win">You win!</span> 🎉';
    } else {
      result = "loss";
      msg = '<span class="lose">Computer wins.</span> Better luck next time.';
    }
    setStatus(msg + ' <button class="btn" id="again" type="button" style="margin-left:10px">Play again</button>');
    document.getElementById("again").addEventListener("click", newGame);
    if (!recorded) {
      recorded = true; // recordResult exactly once per finished game
      var r = D.recordResult(GAME_ID, result, levelAtStart);
      D.toast(r.message);
      D.renderBar(document.getElementById("difficulty-bar"), GAME_ID);
    }
  }

  document.getElementById("new-game").addEventListener("click", newGame);
  document.getElementById("resign").addEventListener("click", function () {
    if (gameOver || recorded) return;
    endGame(AI); // resigning counts as a loss from the human's perspective
  });

  D.renderBar(document.getElementById("difficulty-bar"), GAME_ID);
  newGame();
})();
