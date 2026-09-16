/* Connect 4 UI. Requires connect4-logic.js + js/difficulty.js */
(function () {
  "use strict";
  var GAME_ID = "connect4";
  var D = window.ArcadeDifficulty;
  var C = window.Connect4;

  var HUMAN = "R", AI = "Y";
  var state, levelAtStart, gameOver;
  var boardEl = document.getElementById("board");
  var statusEl = document.getElementById("status");

  function setStatus(html) { statusEl.innerHTML = html; }

  function newGame() {
    state = C.newGame();
    gameOver = false;
    levelAtStart = D.getLevel(GAME_ID);
    render();
    setStatus("Your move — you are <b style='color:var(--red)'>red</b>. Click a column to drop.");
  }

  function render() {
    boardEl.innerHTML = "";
    for (var r = 0; r < C.ROWS; r++) {
      for (var c = 0; c < C.COLS; c++) {
        (function (c) {
          var v = state.grid[r * C.COLS + c];
          var cell = document.createElement("button");
          cell.type = "button";
          cell.className = "cell" + (v === "R" ? " red" : v === "Y" ? " yellow" : "");
          cell.setAttribute("aria-label", "column " + (c + 1));
          cell.disabled = gameOver;
          cell.addEventListener("click", function () { humanTurn(c); });
          boardEl.appendChild(cell);
        })(c);
      }
    }
  }

  function humanTurn(col) {
    if (gameOver || state.turn !== HUMAN) return;
    var res = C.applyMove(state, col);
    if (!res) return;
    state = res.state;
    afterMove();
  }

  function aiTurn() {
    if (gameOver) return;
    setStatus("Computer is thinking…");
    // let the UI paint before the search blocks
    setTimeout(function () {
      var m = C.aiMove(state, levelAtStart);
      if (m < 0) return;
      var res = C.applyMove(state, m);
      if (!res) return;
      state = res.state;
      afterMove();
    }, 60);
  }

  function afterMove() {
    render();
    var w = C.winner(state);
    if (w) return endGame(w);
    if (state.turn === HUMAN) {
      setStatus("Your move — you are <b style='color:var(--red)'>red</b>.");
    } else {
      aiTurn();
    }
  }

  function endGame(w) {
    gameOver = true;
    render();
    var result, msg;
    if (w === "draw") {
      result = "draw";
      msg = '<span class="draw">Draw!</span> The board is full.';
    } else if (w === HUMAN) {
      result = "win";
      msg = '<span class="win">You win!</span> 🎉 Four in a row!';
    } else {
      result = "loss";
      msg = '<span class="lose">Computer wins.</span> It connected four first.';
    }
    setStatus(msg + ' <button class="btn" id="again" style="margin-left:10px">Play again</button>');
    document.getElementById("again").addEventListener("click", newGame);
    var r = D.recordResult(GAME_ID, result, levelAtStart);
    D.toast(r.message);
    D.renderBar(document.getElementById("difficulty-bar"), GAME_ID);
  }

  document.getElementById("new-game").addEventListener("click", newGame);

  D.renderBar(document.getElementById("difficulty-bar"), GAME_ID);
  newGame();
})();
