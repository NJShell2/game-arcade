/* Gomoku UI. Requires gomoku-logic.js + js/difficulty.js */
(function () {
  "use strict";
  var GAME_ID = "gomoku";
  var D = window.ArcadeDifficulty;
  var G = window.Gomoku;

  var state, humanSide, levelAtStart, gameOver, lastMove, winCells;
  var boardEl = document.getElementById("board");
  var statusEl = document.getElementById("status");
  var blackBtn = document.getElementById("side-black");
  var whiteBtn = document.getElementById("side-white");

  function setStatus(html) { statusEl.innerHTML = html; }
  function stoneName(s) { return s === "B" ? "Black ⚫" : "White ⚪"; }

  function newGame() {
    state = G.newGame();
    gameOver = false;
    lastMove = null;
    winCells = null;
    levelAtStart = D.getLevel(GAME_ID);
    humanSide = blackBtn.classList.contains("active") ? "B" : "W";
    boardEl.classList.toggle("human-b", humanSide === "B");
    boardEl.classList.toggle("human-w", humanSide === "W");
    render();
    if (state.turn !== humanSide) {
      setStatus("Computer (" + stoneName(state.turn) + ") is thinking…");
      setTimeout(aiTurn, 60);
    } else {
      setStatus("Your move — you are <b>" + stoneName(humanSide) + "</b>.");
    }
  }

  function render() {
    boardEl.innerHTML = "";
    var winSet = {};
    if (winCells) {
      for (var i = 0; i < winCells.length; i++) {
        winSet[winCells[i][0] * 15 + winCells[i][1]] = 1;
      }
    }
    for (var r = 0; r < 15; r++) {
      for (var c = 0; c < 15; c++) {
        (function (r, c) {
          var i = r * 15 + c;
          var cell = document.createElement("button");
          cell.type = "button";
          cell.className = "gcell";
          cell.setAttribute("aria-label", "Row " + (r + 1) + ", column " + (c + 1));
          var v = state.board[i];
          if (v === "B") cell.classList.add("b");
          if (v === "W") cell.classList.add("w");
          if (lastMove && lastMove[0] === r && lastMove[1] === c) cell.classList.add("last");
          if (winSet[i]) cell.classList.add("win");
          cell.disabled = gameOver || !!v || state.turn !== humanSide;
          cell.addEventListener("click", function () { humanTurn(r, c); });
          boardEl.appendChild(cell);
        })(r, c);
      }
    }
  }

  function humanTurn(r, c) {
    if (gameOver || state.turn !== humanSide) return;
    var n = G.applyMove(state, r, c);
    if (!n) return;
    state = n;
    lastMove = [r, c];
    afterMove();
  }

  function aiTurn() {
    if (gameOver) return;
    var m = G.aiMove(state, levelAtStart);
    if (!m) return;
    state = G.applyMove(state, m[0], m[1]);
    lastMove = m;
    afterMove();
  }

  function afterMove() {
    winCells = G.winLine(state);
    render();
    var w = G.winner(state);
    if (w) return endGame(w);
    if (state.turn === humanSide) {
      setStatus("Your move — you are <b>" + stoneName(humanSide) + "</b>.");
    } else {
      setStatus("Computer (" + stoneName(state.turn) + ") is thinking…");
      setTimeout(aiTurn, 60);
    }
  }

  function endGame(w) {
    gameOver = true;
    render();
    var result, msg;
    if (w === "draw") {
      result = "draw";
      msg = '<span class="draw">Draw!</span> The board is full with no five-in-a-row.';
    } else if (w === humanSide) {
      result = "win";
      msg = '<span class="win">You win!</span> 🎉 Five in a row!';
    } else {
      result = "loss";
      msg = '<span class="lose">Computer wins.</span> Better luck next time.';
    }
    setStatus(msg + ' <button class="btn" id="again" style="margin-left:10px">Play again</button>');
    document.getElementById("again").addEventListener("click", newGame);
    var r = D.recordResult(GAME_ID, result, levelAtStart);
    D.toast(r.message);
    D.renderBar(document.getElementById("difficulty-bar"), GAME_ID);
  }

  document.getElementById("new-game").addEventListener("click", newGame);
  blackBtn.addEventListener("click", function () {
    blackBtn.classList.add("active"); whiteBtn.classList.remove("active"); newGame();
  });
  whiteBtn.addEventListener("click", function () {
    whiteBtn.classList.add("active"); blackBtn.classList.remove("active"); newGame();
  });

  D.renderBar(document.getElementById("difficulty-bar"), GAME_ID);
  newGame();
})();
