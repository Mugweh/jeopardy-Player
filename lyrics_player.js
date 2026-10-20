const socket = io();

socket.on('game_event', (data) => {
    if (data.type === 'SYNC_LYRICS_STATE' || data.type === 'UPDATE_LYRICS_STATE' || data.type === 'SYNC_FULL_STATE') {
        const state = data.state.lyricsState || data.state;
        renderPlayerUI(state);
    }
});

function renderPlayerUI(state) {
    if (!state || !state.gameData) return;

    const game = state.gameData;
    const rIdx = state.currentRound;
    const currentRound = game.rounds[rIdx];

    document.getElementById('round-header').textContent = `ROUND ${rIdx + 1} OF ${game.rounds.length}`;
    document.getElementById('points-header').textContent = `CURRENT ROUND VALUE: ${4 - state.hintsRevealed} POINTS`;
    
    const lyricsContainer = document.getElementById('lyrics-container');
    if (currentRound && currentRound.lyrics && currentRound.lyrics.length > 0) {
        const sIdx = state.currentLyricSection || 0;
        lyricsContainer.textContent = currentRound.lyrics[sIdx] || '';
    } else {
        lyricsContainer.textContent = 'GAME OVER';
    }

    // Render Generic Hint Badges
    const hintsDisplay = document.getElementById('hints-display');
    hintsDisplay.innerHTML = '';
    for (let i = 0; i < state.hintsRevealed; i++) {
        const hintDiv = document.createElement('div');
        hintDiv.className = 'hint-badge';
        hintDiv.textContent = `HINT ${i + 1} REVEALED (Round Value -1)`;
        hintsDisplay.appendChild(hintDiv);
    }

    // Render Answer if Host revealed it
    const ansDiv = document.getElementById('revealed-answer');
    if (state.answerRevealed && currentRound) {
        ansDiv.style.display = 'block';
        ansDiv.textContent = `CORRECT ANSWER: ${currentRound.answer}`;
    } else {
        ansDiv.style.display = 'none';
    }

    // Render Locked-In Badges
    const lockedContainer = document.getElementById('locked-teams');
    lockedContainer.innerHTML = '';
    const subs = state.submissions || {};
    Object.keys(subs).forEach(team => {
        const badge = document.createElement('div');
        badge.className = 'locked-badge';
        badge.textContent = `🔒 ${team} Locked In (${4 - subs[team].stage} Pts Stage)`;
        lockedContainer.appendChild(badge);
    });

    // Scoreboard
    const scoreBoard = document.getElementById('score-board');
    scoreBoard.innerHTML = '';
    const scores = state.scores || {};
    Object.keys(scores).forEach(team => {
        const div = document.createElement('div');
        div.className = 'player-team';
        div.innerHTML = `
            <div class="team-name">${team}</div>
            <div class="team-score">${scores[team]}</div>
        `;
        scoreBoard.appendChild(div);
    });
}