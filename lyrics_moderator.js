const socket = io();
let lyricsState = null;
let sharedTeams = [];

socket.on('game_event', (data) => {
    if (data.type === 'SYNC_FULL_STATE') {
        sharedTeams = data.state.teams || [];
        if (data.state.lyricsState) {
            lyricsState = data.state.lyricsState;
            renderModeratorUI();
        }
    }
    else if (data.type === 'SYNC_LYRICS_STATE' || data.type === 'UPDATE_LYRICS_STATE') {
        lyricsState = data.state;
        renderModeratorUI();
    }
    else if (data.type === 'UPDATE_SCORES') {
        sharedTeams = data.teams || [];
        renderModeratorUI();
    }
});

document.getElementById('lyrics-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
        try {
            const data = JSON.parse(evt.target.result);
            if (data.rounds) {
                data.rounds.forEach(r => {
                    if (typeof r.lyrics === 'string') r.lyrics = [r.lyrics];
                });
            }
            socket.emit('game_event', { type: 'LOAD_LYRICS_GAME', data: data });
        } catch (err) { alert("Invalid JSON file."); }
    };
    reader.readAsText(file);
});

function renderModeratorUI() {
    if (!lyricsState || !lyricsState.gameData) return;

    const game = lyricsState.gameData;
    const rIdx = lyricsState.currentRound;
    const currentRound = game.rounds[rIdx];

    document.getElementById('round-status').textContent = `Round ${rIdx + 1} of ${game.rounds.length} | Max Points: ${4 - lyricsState.hintsRevealed}`;
    
    // Snippets Handling
    if (currentRound && currentRound.lyrics && currentRound.lyrics.length > 0) {
        const sIdx = lyricsState.currentLyricSection || 0;
        document.getElementById('snippet-tracker').textContent = `Snippet ${sIdx + 1} of ${currentRound.lyrics.length}`;
        document.getElementById('mod-lyrics-text').textContent = currentRound.lyrics[sIdx] || '(Empty Snippet)';
    } else {
        document.getElementById('snippet-tracker').textContent = `Snippet 0 of 0`;
        document.getElementById('mod-lyrics-text').textContent = 'End of game or no lyrics.';
    }

    document.getElementById('mod-answer-text').textContent = currentRound ? currentRound.answer : '...';

    // Hints Counter Status
    const hintsDiv = document.getElementById('mod-hints-list');
    hintsDiv.innerHTML = `<strong>Hints Revealed (via Wheel): ${lyricsState.hintsRevealed} / 3</strong>`;
    for (let i = 1; i <= 3; i++) {
        const isShown = i <= lyricsState.hintsRevealed;
        hintsDiv.innerHTML += `<div style="padding:5px; margin-top:5px; background:${isShown ? '#059669' : '#2a2a2a'}; border-radius:4px;">Hint Stage ${i}${isShown ? ' (ACTIVE)' : ''}</div>`;
    }

    // Render Player Submissions
    const subList = document.getElementById('submissions-list');
    subList.innerHTML = '';
    const subs = lyricsState.submissions || {};
    const subTeams = Object.keys(subs);

    if (subTeams.length === 0) {
        subList.innerHTML = '<em style="color:#666;">No submissions yet for this round.</em>';
    } else {
        subTeams.forEach(team => {
            const entry = subs[team];
            const ptsVal = 4 - entry.stage;
            const item = document.createElement('div');
            item.style.padding = '10px';
            item.style.background = '#2a2a2a';
            item.style.borderRadius = '6px';
            item.style.display = 'flex';
            item.style.justifyContent = 'space-between';
            item.style.alignItems = 'center';

            item.innerHTML = `
                <div>
                    <strong style="color:var(--neon-yellow);">${team}</strong> (at ${entry.stage} hints | Value: ${ptsVal} pts)
                    <div style="font-size:1.1rem; margin-top:4px;">"${entry.answer}"</div>
                    <div style="font-size:0.85rem; color:${entry.status === 'CORRECT' ? '#10b981' : entry.status === 'INCORRECT' ? '#ef4444' : '#ccc'}">Status: ${entry.status}</div>
                </div>
                <div style="display:flex; gap:6px;">
                    <button onclick="gradeTeam('${team}', true)" style="background:#10b981; padding:6px 10px;">Correct (+${ptsVal})</button>
                    <button onclick="gradeTeam('${team}', false)" style="background:#ef4444; padding:6px 10px;">Incorrect (-${ptsVal})</button>
                </div>
            `;
            subList.appendChild(item);
        });
    }

    // Render Shared Teams & Scoreboard with Manual Adjustment + Unclaim Controls
    const scoreDiv = document.getElementById('mod-scores-list');
    scoreDiv.innerHTML = '';
    
    // Merge shared teams with lyrics score state
    const allTeams = Array.from(new Set([...sharedTeams.map(t => t.name), ...Object.keys(lyricsState.scores || {})]));

    allTeams.forEach(teamName => {
        const score = lyricsState.scores[teamName] || 0;
        const row = document.createElement('div');
        row.className = 'team';
        row.style.marginBottom = '8px';
        
        row.innerHTML = `
            <span style="font-weight:bold; font-size:1.1rem;">${teamName}</span>
            <div class="score-controls">
                <button class="btn-unclaim-team" onclick="unclaimTeam('${teamName}')" title="Unclaim Team" style="background-color: #8b5cf6; color: white; padding: 4px 10px;">🔓</button>
                <button onclick="adjustScore('${teamName}', -1)" style="padding:4px 10px;">-</button>
                <span class="score" style="min-width:35px; text-align:center; color:var(--neon-yellow);">${score}</span>
                <button onclick="adjustScore('${teamName}', 1)" style="padding:4px 10px;">+</button>
            </div>
        `;
        scoreDiv.appendChild(row);
    });
}

function gradeTeam(team, isCorrect) {
    socket.emit('game_event', { type: 'GRADE_LYRICS_SUBMISSION', team: team, isCorrect: isCorrect });
}

function adjustScore(team, direction) {
    const amount = parseInt(document.getElementById('manual-score-input').value, 10) || 1;
    socket.emit('game_event', { type: 'ADJUST_LYRICS_SCORE', team: team, amount: amount * direction });
}

function unclaimTeam(teamName) {
    if (confirm(`Force player on "${teamName}" to unclaim and rejoin?`)) {
        socket.emit('game_event', { type: 'UNCLAIM_TEAM', team: teamName });
    }
}

document.getElementById('btn-prev-snippet').addEventListener('click', () => {
    socket.emit('game_event', { type: 'CYCLE_LYRICS_SECTION', direction: -1 });
});

document.getElementById('btn-next-snippet').addEventListener('click', () => {
    socket.emit('game_event', { type: 'CYCLE_LYRICS_SECTION', direction: 1 });
});

document.getElementById('btn-reveal-hint').addEventListener('click', () => {
    socket.emit('game_event', { type: 'REVEAL_LYRICS_HINT' });
});

document.getElementById('btn-reveal-answer').addEventListener('click', () => {
    socket.emit('game_event', { type: 'REVEAL_LYRICS_ANSWER' });
});

document.getElementById('btn-next-round').addEventListener('click', () => {
    socket.emit('game_event', { type: 'NEXT_LYRICS_ROUND' });
});

document.getElementById('btn-reset-claims').addEventListener('click', () => {
    if (confirm("Force all buzzed-in players back to the setup screen?")) {
        socket.emit('game_event', { type: 'RESET_CLAIMS' });
    }
});