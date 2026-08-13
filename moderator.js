// Connect to the Python WebSocket Server
const socket = io();

const gameChannel = {
    postMessage: (data) => {
        socket.emit('game_event', data);
    }
};

socket.on('game_event', (data) => {
    if (typeof gameChannel.onmessage === 'function') {
        gameChannel.onmessage({ data: data });
    }
});

// --- EXISTING GAME LOGIC ---
let gameData = null;
let activeClueId = null; 
let currentClueValue = 0; 
let dailyDoubleId = null; 
let timerInterval = null; 
let timerSeconds = 30;
let buzzerOrder = []; 
let teamWagers = {}; // NEW: Stores dynamically submitted wagers

document.getElementById('game-file').addEventListener('change', handleFileUpload);

gameChannel.onmessage = (event) => {
    const message = event.data;
    
    if (message.type === 'SYNC_FULL_STATE') {
        const state = message.state;

        if (state.gameData) {
            gameData = state.gameData;
            buildModeratorBoard(gameData);

            state.answeredClues.forEach(clueId => {
                const parts = clueId.split('-');
                if(parts.length === 3) {
                    const modCell = document.getElementById(`mod-clue-${parts[1]}-${parts[2]}`);
                    if (modCell) modCell.classList.add('answered');
                }
            });
        }
        
        teamWagers = state.teamWagers || {};
        
        if (state.teams && state.teams.length > 0) {
            syncModeratorScoresUI(state.teams);
        }
        buzzerOrder = state.buzzerOrder || [];
        renderBuzzerList();
        
        if (state.activeOverlay && state.activeOverlay.clueId && gameData) {
            const parts = state.activeOverlay.clueId.split('-');
            const clue = gameData.categories[parts[1]].clues[parts[2]];
            displayClueDetailsMod(parts[1], parts[2], clue, state.activeOverlay.type === 'SHOW_DAILY_DOUBLE');
        }
    }
    else if (message.type === 'LOAD_GAME') {
        gameData = message.data;
        buildModeratorBoard(gameData);
    }
    else if (message.type === 'UPDATE_SCORES') {
        syncModeratorScoresUI(message.teams);
    }
    else if (message.type === 'SHOW_PROMPT' || message.type === 'SHOW_DAILY_DOUBLE') {
        if (message.clueId && gameData && activeClueId !== message.clueId) {
            const parts = message.clueId.split('-');
            const clue = gameData.categories[parts[1]].clues[parts[2]];
            displayClueDetailsMod(parts[1], parts[2], clue, message.type === 'SHOW_DAILY_DOUBLE');
            document.getElementById(`mod-clue-${parts[1]}-${parts[2]}`).classList.add('answered');
        }
    }
    else if (message.type === 'CLOSE_CLUE' || message.type === 'RESET_GAME') {
        resetModPanelUI();
        if (message.type === 'RESET_GAME') {
            document.querySelectorAll('.cell.points').forEach(cell => cell.classList.remove('answered'));
            document.querySelectorAll('.team .score').forEach(score => score.textContent = '0');
        }
    }
    else if (message.type === 'BUZZ_IN') {
        if (!buzzerOrder.includes(message.team)) {
            buzzerOrder.push(message.team);
            renderBuzzerList();
            gameChannel.postMessage({ type: 'BUZZER_ORDER', order: buzzerOrder });
        }
    }
    else if (message.type === 'SUBMIT_WAGER') {
        teamWagers[message.team] = message.wager;
        document.querySelectorAll('.team').forEach(teamDiv => {
            if (teamDiv.querySelector('input').value === message.team) {
                teamDiv.querySelector('.wager-display').textContent = `(W: ${message.wager})`;
            }
        });
    }
    else if (message.type === 'CLEAR_WAGER') {
        delete teamWagers[message.team];
        document.querySelectorAll('.team').forEach(teamDiv => {
            if (teamDiv.querySelector('input').value === message.team) {
                teamDiv.querySelector('.wager-display').textContent = '';
            }
        });
    }
};

function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            gameData = JSON.parse(e.target.result);
            
            if (gameData.finalJeopardy) {
                document.getElementById('mod-fj-category-text').textContent = gameData.finalJeopardy.category || '...';
                document.getElementById('mod-fj-prompt-text').textContent = gameData.finalJeopardy.prompt || '...';
                document.getElementById('mod-fj-answer-text').textContent = gameData.finalJeopardy.answer || '...';
                
                renderModeratorMedia(gameData.finalJeopardy, document.getElementById('mod-fj-media-container'));
            }

            const randomCol = Math.floor(Math.random() * gameData.categories.length);
            const randomRow = Math.floor(Math.random() * 5);
            gameData.dailyDoubleId = `clue-${randomCol}-${randomRow}`;

            buildModeratorBoard(gameData);
            gameChannel.postMessage({ type: 'LOAD_GAME', data: gameData });
            setTimeout(broadcastScores, 500); 
        } catch (error) {
            alert("Error parsing JSON file. Please ensure it's valid.");
        }
    };
    reader.readAsText(file);
}

function buildModeratorBoard(data) {
    const board = document.getElementById('mini-board');
    board.innerHTML = ''; 

    if (data.dailyDoubleId) {
        dailyDoubleId = data.dailyDoubleId;
    } else {
        dailyDoubleId = `clue-${Math.floor(Math.random() * data.categories.length)}-${Math.floor(Math.random() * 5)}`;
        data.dailyDoubleId = dailyDoubleId;
    }

    data.categories.forEach(category => {
        const catDiv = document.createElement('div');
        catDiv.className = 'cell category';
        catDiv.textContent = category.name;
        board.appendChild(catDiv);
    });

    for (let row = 0; row < 5; row++) {
        for (let col = 0; col < data.categories.length; col++) {
            const clue = data.categories[col].clues[row];
            const pointsDiv = document.createElement('div');
            pointsDiv.className = 'cell points';
            pointsDiv.id = `mod-clue-${col}-${row}`;
            
            if (`clue-${col}-${row}` === dailyDoubleId) {
                pointsDiv.classList.add('daily-double-mod');
                pointsDiv.innerHTML = `${clue.points}<br><span style="font-size: 0.7rem; color: var(--neon-yellow);">(DD)</span>`;
            } else {
                pointsDiv.textContent = clue.points;
            }
            
            pointsDiv.addEventListener('click', () => {
                if (!pointsDiv.classList.contains('answered')) {
                    pointsDiv.classList.add('answered');
                    displayClueDetailsMod(col, row, clue, `clue-${col}-${row}` === dailyDoubleId);
                    
                    if (`clue-${col}-${row}` === dailyDoubleId) {
                        gameChannel.postMessage({ type: 'SHOW_DAILY_DOUBLE', clueId: activeClueId });
                    } else {
                        gameChannel.postMessage({ 
                            type: 'SHOW_PROMPT', 
                            clueId: activeClueId, 
                            prompt: clue.prompt,
                            mediaType: clue.type || 'text',
                            mediaUrl: clue.url || null
                        });
                        buzzerOrder = [];
                        renderBuzzerList();
                        gameChannel.postMessage({ type: 'ENABLE_BUZZERS' });
                    }
                }
            });
            board.appendChild(pointsDiv);
        }
    }
}

function renderModeratorMedia(clue, mediaContainer) {
    mediaContainer.innerHTML = ''; 
    
    if (clue.type === 'image' && clue.url) {
        const urls = clue.url.split(',').map(u => u.trim());
        urls.forEach(url => {
            const img = document.createElement('img');
            img.src = url;
            img.style.maxWidth = "45%";
            img.style.maxHeight = "150px";
            img.style.marginRight = "10px";
            img.style.borderRadius = "8px";
            mediaContainer.appendChild(img);
        });
    }
    else if (clue.type === 'video' && clue.url) {
        const vid = document.createElement('video');
        vid.src = clue.url;
        vid.controls = true;
        vid.style.maxWidth = "100%";
        vid.style.maxHeight = "200px";
        vid.style.borderRadius = "8px";
        mediaContainer.appendChild(vid);
    }
    else if (clue.type === 'audio' && clue.url) {
        const urls = clue.url.split(',').map(u => u.trim());
        
        urls.forEach((url, idx) => {
            const wrapper = document.createElement('div');
            wrapper.style.marginBottom = "15px";
            wrapper.style.padding = "10px";
            wrapper.style.background = "#2a2a2a";
            wrapper.style.borderRadius = "8px";

            const aud = document.createElement('audio');
            aud.src = url;
            aud.controls = true;
            aud.style.width = "100%";
            aud.style.marginBottom = "10px";
            
            const broadcastBtn = document.createElement('button');
            broadcastBtn.textContent = `🔊 Broadcast Audio ${urls.length > 1 ? idx + 1 : ''} to Players`;
            broadcastBtn.style.backgroundColor = "var(--jeopardy-blue)";
            broadcastBtn.style.width = "100%";
            
            broadcastBtn.onclick = () => {
                gameChannel.postMessage({ type: 'PLAY_AUDIO_REMOTE', url: url });
                broadcastBtn.textContent = "🔊 Broadcasting...";
                broadcastBtn.style.backgroundColor = "var(--accent-green)";
                setTimeout(() => {
                    broadcastBtn.textContent = `🔊 Broadcast Audio ${urls.length > 1 ? idx + 1 : ''} to Players`;
                    broadcastBtn.style.backgroundColor = "var(--jeopardy-blue)";
                }, 2000);
            };

            wrapper.appendChild(aud);
            wrapper.appendChild(broadcastBtn);
            mediaContainer.appendChild(wrapper);
        });
    }
    else if (clue.type === 'spotify' && clue.url) {
        let trackId = clue.url.includes("track/") ? clue.url.split('track/')[1].split('?')[0] : "";
        const iframe = document.createElement('iframe');
        iframe.src = `https://open.spotify.com/embed/track/${trackId}?utm_source=generator&theme=0`;
        iframe.width = "100%"; iframe.height = "152";
        iframe.allow = "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture";
        iframe.style.borderRadius = "12px";
        mediaContainer.appendChild(iframe);
    }
    else if (clue.type === 'youtube' && clue.url) {
        let videoId = clue.url.includes("v=") ? clue.url.split('v=')[1].split('&')[0] : 
                      (clue.url.includes("youtu.be/") ? clue.url.split('youtu.be/')[1].split('?')[0] : "");
        if (videoId) {
            const iframe = document.createElement('iframe');
            iframe.src = `https://www.youtube.com/embed/${videoId}?controls=1`;
            iframe.width = "100%"; iframe.height = "200"; 
            iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
            iframe.allowFullscreen = true;
            iframe.style.borderRadius = "8px";
            mediaContainer.appendChild(iframe);
        }
    }
}

function displayClueDetailsMod(col, row, clue, isDailyDouble) {
    const categoryTitle = document.getElementById('current-category');
    activeClueId = `clue-${col}-${row}`;

    if (isDailyDouble) {
        categoryTitle.innerHTML = `${gameData.categories[col].name} - 🚨 [DAILY DOUBLE] 🚨`;
        currentClueValue = 0; // Wager logic takes over automatically
    } else {
        categoryTitle.textContent = `${gameData.categories[col].name} - ${clue.points}`;
        currentClueValue = parseInt(clue.points, 10) || 0;
    }

    document.getElementById('mod-prompt-text').textContent = clue.prompt + (clue.url ? ` (${clue.type.toUpperCase()})` : '');
    document.getElementById('mod-response-text').textContent = clue.response;
    renderModeratorMedia(clue, document.getElementById('mod-media-container'));
}

function resetModPanelUI() {
    document.getElementById('current-category').textContent = 'Category - Point Value';
    document.getElementById('mod-prompt-text').textContent = 'Select a question from the board on the left.';
    document.getElementById('mod-response-text').textContent = '...';
    document.getElementById('mod-media-container').innerHTML = '';
    activeClueId = null;
    currentClueValue = 0; 
    if (timerInterval) clearInterval(timerInterval);
    
    // Purge wagers across the board visually
    teamWagers = {};
    document.querySelectorAll('.wager-display').forEach(el => el.textContent = '');
    
    buzzerOrder = [];
    renderBuzzerList();
}

document.getElementById('btn-show-prompt').addEventListener('click', () => {
    if (!activeClueId) return;
    const [_, col, row] = activeClueId.split('-');
    const clue = gameData.categories[col].clues[row];

    gameChannel.postMessage({ 
        type: 'SHOW_PROMPT', 
        prompt: clue.prompt,
        mediaType: clue.type || 'text',
        mediaUrl: clue.url || null
    });

    buzzerOrder = [];
    renderBuzzerList();
    gameChannel.postMessage({ type: 'ENABLE_BUZZERS' });
});

document.getElementById('btn-show-answer').addEventListener('click', () => {
    const responseText = document.getElementById('mod-response-text').textContent;
    gameChannel.postMessage({ type: 'SHOW_ANSWER', answer: responseText });
});

document.getElementById('btn-close-clue').addEventListener('click', () => {
    gameChannel.postMessage({ type: 'CLOSE_CLUE' });
    gameChannel.postMessage({ type: 'HIDE_TIMER' });
    gameChannel.postMessage({ type: 'DISABLE_BUZZERS' });
    resetModPanelUI();
});

function syncModeratorScoresUI(teamsData) {
    const teamContainer = document.getElementById('team-scores');
    document.querySelectorAll('.team').forEach(el => el.remove());

    teamsData.forEach((team, index) => {
        const newTeam = document.createElement('div');
        newTeam.className = 'team';
        
        const displayWager = teamWagers[team.name] !== undefined ? `(W: ${teamWagers[team.name]})` : '';
        
        newTeam.innerHTML = `
            <input type="text" value="${team.name}">
            <div class="score-controls">
                <span class="wager-display" style="color: var(--neon-yellow); font-size: 0.9rem; margin-right: 10px; font-weight: bold;">${displayWager}</span>
                <button class="btn-clear-wager" title="Clear Wager" style="background-color: #555; color: white; border: 1px solid var(--border-color); padding: 4px 10px; margin-right: 5px;">🚫</button>
                <button class="btn-wager" title="Request Wager" style="background-color: var(--neon-yellow); color: #121212; padding: 4px 10px; margin-right: 5px;">💰</button>
                <button class="minus">-</button>
                <span class="score">${team.score}</span>
                <button class="plus">+</button>
                <button class="bonus-plus" title="Add Bonus">+B</button>
                <button class="remove-team" title="Remove Team">✖</button>
            </div>
        `;
        teamContainer.insertBefore(newTeam, document.getElementById('btn-add-team'));
        attachTeamListeners(newTeam);
    });
}

function attachTeamListeners(teamDiv) {
    const minusBtn = teamDiv.querySelector('.minus');
    const plusBtn = teamDiv.querySelector('.plus');
    const scoreDisplay = teamDiv.querySelector('.score');
    const nameInput = teamDiv.querySelector('input');
    const removeBtn = teamDiv.querySelector('.remove-team'); 
    const bonusBtn = teamDiv.querySelector('.bonus-plus'); 
    const wagerBtn = teamDiv.querySelector('.btn-wager');
    const clearWagerBtn = teamDiv.querySelector('.btn-clear-wager');

    plusBtn.addEventListener('click', () => {
        let teamName = nameInput.value;
        let amount = (teamWagers[teamName] !== undefined) ? teamWagers[teamName] : currentClueValue;
        let score = parseInt(scoreDisplay.textContent, 10) || 0;
        score += amount;
        scoreDisplay.textContent = score;
        broadcastScores();
    });

    minusBtn.addEventListener('click', () => {
        let teamName = nameInput.value;
        let amount = (teamWagers[teamName] !== undefined) ? teamWagers[teamName] : currentClueValue;
        let score = parseInt(scoreDisplay.textContent, 10) || 0;
        score -= amount;
        scoreDisplay.textContent = score;
        broadcastScores();
    });
    
    if (bonusBtn) {
        bonusBtn.addEventListener('click', () => {
            let bonusScore = parseInt(document.getElementById('bonus-input').value, 10) || 0;
            let score = parseInt(scoreDisplay.textContent, 10) || 0;
            score += bonusScore;
            scoreDisplay.textContent = score;
            broadcastScores();
        });
    }

    if (wagerBtn) {
        wagerBtn.addEventListener('click', () => {
            gameChannel.postMessage({ type: 'REQUEST_WAGER', team: nameInput.value });
            wagerBtn.textContent = '⏳';
            setTimeout(() => wagerBtn.textContent = '💰', 2000);
        });
    }

    if (clearWagerBtn) {
        clearWagerBtn.addEventListener('click', () => {
            let teamName = nameInput.value;
            delete teamWagers[teamName];
            teamDiv.querySelector('.wager-display').textContent = '';
            gameChannel.postMessage({ type: 'CLEAR_WAGER', team: teamName });
        });
    }

    nameInput.addEventListener('input', () => broadcastScores());

    if (removeBtn) {
        removeBtn.addEventListener('click', () => {
            if (confirm(`Remove ${nameInput.value}?`)) {
                teamDiv.remove(); 
                broadcastScores(); 
            }
        });
    }
}

document.querySelectorAll('.team').forEach(attachTeamListeners);

document.getElementById('btn-add-team').addEventListener('click', () => {
    const teamContainer = document.getElementById('team-scores');
    const teamCount = document.querySelectorAll('.team').length + 1; 
    const newTeam = document.createElement('div');
    newTeam.className = 'team';
    newTeam.innerHTML = `
        <input type="text" value="Team ${teamCount}">
        <div class="score-controls">
            <span class="wager-display" style="color: var(--neon-yellow); font-size: 0.9rem; margin-right: 10px; font-weight: bold;"></span>
            <button class="btn-clear-wager" title="Clear Wager" style="background-color: #555; color: white; border: 1px solid var(--border-color); padding: 4px 10px; margin-right: 5px;">🚫</button>
            <button class="btn-wager" title="Request Wager" style="background-color: var(--neon-yellow); color: #121212; padding: 4px 10px; margin-right: 5px;">💰</button>
            <button class="minus">-</button>
            <span class="score">0</span>
            <button class="plus">+</button>
            <button class="bonus-plus" title="Add Bonus">+B</button>
            <button class="remove-team" title="Remove Team">✖</button>
        </div>
    `;
    teamContainer.insertBefore(newTeam, document.getElementById('btn-add-team'));
    attachTeamListeners(newTeam);
    broadcastScores(); 
});

function broadcastScores() {
    const teams = Array.from(document.querySelectorAll('.team')).map(teamDiv => ({
        name: teamDiv.querySelector('input').value,
        score: parseInt(teamDiv.querySelector('.score').textContent, 10) || 0
    }));
    gameChannel.postMessage({ type: 'UPDATE_SCORES', teams: teams });
}

document.getElementById('btn-force-sync').addEventListener('click', () => {
    gameChannel.postMessage({ type: 'FORCE_SYNC' });
    
    const btn = document.getElementById('btn-force-sync');
    const originalText = btn.textContent;
    btn.textContent = "Synced!";
    btn.style.backgroundColor = "var(--accent-green)";
    
    setTimeout(() => {
        btn.textContent = originalText;
        btn.style.backgroundColor = "var(--accent-blue)";
    }, 1500);
});

document.getElementById('btn-reset-game').addEventListener('click', () => {
    if (!confirm("Are you sure you want to reset the game? This will clear all scores and board progress.")) {
        return; 
    }
    gameChannel.postMessage({ type: 'HIDE_TIMER' });
    gameChannel.postMessage({ type: 'DISABLE_BUZZERS' });
    gameChannel.postMessage({ type: 'RESET_GAME' });
    resetModPanelUI();
});

document.getElementById('btn-fj-category').addEventListener('click', () => {
    const cat = gameData.finalJeopardy?.category || 'Final Jeopardy';
    gameChannel.postMessage({ type: 'SHOW_FJ_CATEGORY', category: cat });
});

document.getElementById('btn-fj-prompt').addEventListener('click', () => {
    const fj = gameData.finalJeopardy;
    if (!fj) return;
    
    gameChannel.postMessage({ 
        type: 'SHOW_FJ_PROMPT', 
        prompt: fj.prompt || '...',
        mediaType: fj.type || 'text',
        mediaUrl: fj.url || null
    });
});

document.getElementById('btn-fj-answer').addEventListener('click', () => {
    const answer = gameData.finalJeopardy?.answer || '...';
    gameChannel.postMessage({ type: 'SHOW_FJ_ANSWER', answer: answer });
});

const modTimerDisplay = document.getElementById('mod-timer-display');
const timerInput = document.getElementById('timer-input');

document.getElementById('btn-start-timer').addEventListener('click', () => {
    if (timerInterval) clearInterval(timerInterval);
    timerSeconds = parseInt(timerInput.value, 10) || 0;
    modTimerDisplay.textContent = timerSeconds;
    gameChannel.postMessage({ type: 'SYNC_TIMER', time: timerSeconds });

    timerInterval = setInterval(() => {
        timerSeconds--;
        if (timerSeconds <= 0) {
            timerSeconds = 0;
            clearInterval(timerInterval);
        }
        modTimerDisplay.textContent = timerSeconds;
        gameChannel.postMessage({ type: 'SYNC_TIMER', time: timerSeconds });
    }, 1000);
});

document.getElementById('btn-stop-timer').addEventListener('click', () => {
    if (timerInterval) clearInterval(timerInterval);
    timerInput.value = timerSeconds; 
});

document.getElementById('btn-reset-timer').addEventListener('click', () => {
    if (timerInterval) clearInterval(timerInterval);
    timerSeconds = parseInt(timerInput.value, 10) || 30; 
    modTimerDisplay.textContent = timerSeconds;
    gameChannel.postMessage({ type: 'HIDE_TIMER' }); 
});

function renderBuzzerList() {
    const list = document.getElementById('buzzer-list');
    list.innerHTML = '';
    
    if (buzzerOrder.length === 0) {
        list.innerHTML = '<li style="color: #666; font-style: italic;">No buzzes yet.</li>';
        return;
    }
    
    buzzerOrder.forEach((team, index) => {
        const li = document.createElement('li');
        li.style.padding = '8px 5px';
        li.style.borderBottom = '1px solid #333';
        li.style.color = index === 0 ? 'var(--neon-yellow)' : 'white';
        li.style.fontWeight = index === 0 ? 'bold' : 'normal';
        li.textContent = `${index + 1}. ${team}`;
        list.appendChild(li);
    });
}

document.getElementById('btn-clear-buzzers').addEventListener('click', () => {
    buzzerOrder = [];
    renderBuzzerList();
    gameChannel.postMessage({ type: 'ENABLE_BUZZERS' }); 
});

document.getElementById('btn-next-buzzer').addEventListener('click', () => {
    if (buzzerOrder.length > 0) {
        buzzerOrder.shift(); 
        renderBuzzerList(); 
        gameChannel.postMessage({ type: 'BUZZER_ORDER', order: buzzerOrder });
    }
});

// NEW: Reset Claims Logic
document.getElementById('btn-reset-claims').addEventListener('click', () => {
    if (confirm("Force all buzzed-in players back to the setup screen to pick their teams again?")) {
        gameChannel.postMessage({ type: 'RESET_CLAIMS' });
    }
});