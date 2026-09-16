/* Tic-Tac-Toe UI. Requires tictactoe-logic.js + js/difficulty.js */
(function () {
  "use strict";
  var GAME_ID = "tictactoe";
  var D = window.ArcadeDifficulty;
  var T = window.TicTacToe;

  var state, humanSide, levelAtStart, gameOver;
  var boardEl = document.getElementById("board");
  var statusEl = document.getElementById("status");
  var sideXBtn = document.getElementById("side-x");
  var sideOBtn = document.getElementById("side-o");

  function setStatus(html) { statusEl.innerHTML = html; }

  function newGame() {
    state = T.newGame();
    gameOver = false;
    levelAtStart = D.getLevel(GAME_ID);
    humanSide = sideXBtn.classList.contains("active") ? "X" : "O";
    render();
    if (state.turn !== humanSide) {
      setStatus("Computer (" + state.turn + ") is thinking…");
      setTimeout(aiTurn, 450);
    } else {
      setStatus("Your move (" + humanSide + ").");
    }
  }

  function render() {
    boardEl.innerHTML = "";
    for (var i = 0; i < 9; i++) {
      (function (i) {
        var cell = document.createElement("button");
        cell.type = "button";
        cell.className = "cell";
        cell.textContent = state.board[i] || "";
        if (state.board[i] === "X") cell.classList.add("x");
        if (state.board[i] === "O") cell.classList.add("o");
        cell.disabled = gameOver || !!state.board[i];
        cell.addEventListener("click", function () { humanTurn(i); });
        boardEl.appendChild(cell);
      })(i);
    }
  }

  function humanTurn(i) {
    if (gameOver || state.turn !== humanSide) return;
    var n = T.applyMove(state, i);
    if (!n) return;
    state = n;
    afterMove();
  }

  function aiTurn() {
    if (gameOver) return;
    var m = T.aiMove(state, levelAtStart);
    if (m < 0) return;
    state = T.applyMove(state, m);
    afterMove();
  }

  function afterMove() {
    render();
    var w = T.winner(state);
    if (w) return endGame(w);
    if (state.turn === humanSide) {
      setStatus("Your move (" + humanSide + ").");
    } else {
      setStatus("Computer (" + state.turn + ") is thinking…");
      setTimeout(aiTurn, 450);
    }
  }

  function endGame(w) {
    gameOver = true;
    render();
    var result, msg;
    if (w === "draw") {
      result = "draw";
      msg = '<span class="draw">Draw!</span> Nobody wins this one.';
    } else if (w === humanSide) {
      result = "win";
      msg = '<span class="win">You win!</span> 🎉';
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
  sideXBtn.addEventListener("click", function () {
    sideXBtn.classList.add("active"); sideOBtn.classList.remove("active"); newGame();
  });
  sideOBtn.addEventListener("click", function () {
    sideOBtn.classList.add("active"); sideXBtn.classList.remove("active"); newGame();
  });

  D.renderBar(document.getElementById("difficulty-bar"), GAME_ID);
  newGame();
})();
