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

// --- GAME LOGIC ---

gameChannel.onmessage = (event) => {
    const message = event.data;

    if (message.type === 'SYNC_FULL_STATE') {
        const state = message.state;

        // Restore Board Data
        if (state.gameData) {
            buildPlayerBoard(state.gameData);
            // Re-grey out clues already answered
            state.answeredClues.forEach(clueId => {
                const cell = document.getElementById(clueId);
                if (cell) cell.classList.add('answered');
            });
        }
        
        // Restore Scores
        if (state.teams) {
            updatePlayerScoresUI(state.teams);
        }

        // Restore active overlays dynamically
        if (state.activeOverlay) {
            gameChannel.onmessage({ data: state.activeOverlay });
        }
    }
    else if (message.type === 'LOAD_GAME') {
        buildPlayerBoard(message.data);
    } 
    else if (message.type === 'SHOW_DAILY_DOUBLE') {
        if (message.clueId) {
             const gridCell = document.getElementById(message.clueId);
             if (gridCell) gridCell.classList.add('answered');
        }
        
        const overlay = document.getElementById('active-clue-overlay');
        const textContainer = document.getElementById('clue-text');
        
        const existingMedia = document.getElementById('media-container');
        if (existingMedia) existingMedia.remove();
        
        const existingWrapper = document.getElementById('all-media-wrapper');
        if (existingWrapper) existingWrapper.remove();

        textContainer.innerHTML = "<div style='font-size: 8vw; color: var(--neon-yellow); text-transform: uppercase; font-weight: 900; letter-spacing: 5px; text-shadow: 0 0 30px rgba(255, 204, 0, 0.8), 5px 5px 10px rgba(0,0,0,1);'>Daily Double</div>";

        overlay.classList.add('show-overlay');
    }
    else if (message.type === 'SHOW_PROMPT') {
        if (message.clueId) {
             const gridCell = document.getElementById(message.clueId);
             if (gridCell) gridCell.classList.add('answered');
        }
        
        const overlay = document.getElementById('active-clue-overlay');
        const textContainer = document.getElementById('clue-text');
        
        renderPlayerMedia(message, textContainer, overlay);
        overlay.classList.add('show-overlay');
    }
    else if (message.type === 'PLAY_AUDIO_REMOTE') {
        const aud = document.createElement('audio');
        aud.src = message.url;
        aud.autoplay = true;
        aud.className = 'remote-audio';
        aud.style.display = 'none'; // Keep it hidden
        
        const overlay = document.getElementById('active-clue-overlay');
        if (overlay) overlay.appendChild(aud);
    }
    else if (message.type === 'SHOW_ANSWER' || message.type === 'SHOW_FJ_ANSWER') {
        const textContainer = document.getElementById('clue-text');
        const answerText = message.answer ? message.answer.replace(/\n/g, '<br>') : '...';
        
        const answerHtml = `<div style="color: #10b981; font-size: 3.5vw; text-shadow: 0 0 15px rgba(16, 185, 129, 0.5); margin-top: 15px;">${answerText}</div>`;
        
        // Prevent duplicate answers if host clicks twice
        if (!textContainer.innerHTML.includes(answerText)) {
            textContainer.innerHTML += answerHtml;
        }

        // Handle Side-by-Side Answer Media
        if (message.responseType && message.responseType !== 'text' && message.responseUrl) {
            const overlay = document.getElementById('active-clue-overlay');
            let mediaWrapper = document.getElementById('all-media-wrapper');
            
            if (!mediaWrapper) {
                mediaWrapper = document.createElement('div');
                mediaWrapper.id = 'all-media-wrapper';
                mediaWrapper.style.display = 'flex';
                mediaWrapper.style.gap = '20px';
                mediaWrapper.style.justifyContent = 'center';
                mediaWrapper.style.alignItems = 'center';
                mediaWrapper.style.flexWrap = 'wrap';
                mediaWrapper.style.marginBottom = '15px';
                mediaWrapper.style.width = '100%';
                
                const existingMedia = document.getElementById('media-container');
                if (existingMedia) {
                    overlay.insertBefore(mediaWrapper, existingMedia);
                    mediaWrapper.appendChild(existingMedia);
                    existingMedia.style.marginBottom = '0';
                    existingMedia.style.flex = '0 1 auto';
                } else {
                    overlay.insertBefore(mediaWrapper, textContainer);
                }
            }
            
            const respContainer = document.createElement('div');
            respContainer.id = 'response-media-container';
            respContainer.style.flex = '0 1 auto';
            respContainer.style.display = 'flex';
            respContainer.style.justifyContent = 'center';
            respContainer.style.alignItems = 'center';
            respContainer.style.gap = '20px';
            
            if (message.responseType === 'image') {
                const urls = message.responseUrl.split(',').map(u => u.trim());
                urls.forEach(url => {
                    const img = document.createElement('img');
                    img.src = url;
                    img.className = 'clue-image-multi';
                    img.style.border = '4px solid #10b981';
                    img.style.boxShadow = '0 0 20px rgba(16, 185, 129, 0.6)';
                    respContainer.appendChild(img);
                });
            } else if (message.responseType === 'video') {
                const vid = document.createElement('video');
                vid.src = message.responseUrl;
                vid.autoplay = true;
                vid.controls = true;
                vid.className = 'clue-video';
                vid.style.maxWidth = '40vw';
                vid.style.border = '4px solid #10b981';
                vid.style.boxShadow = '0 0 20px rgba(16, 185, 129, 0.6)';
                respContainer.appendChild(vid);
            }
            
            mediaWrapper.appendChild(respContainer);
            
            // Shrink any existing question media so it fits seamlessly alongside the answer
            const existingImgs = mediaWrapper.querySelectorAll('.clue-image');
            existingImgs.forEach(img => img.className = 'clue-image-multi');
            
            const existingVids = mediaWrapper.querySelectorAll('.clue-video:not([src="'+message.responseUrl+'"])');
            existingVids.forEach(vid => vid.style.maxWidth = '40vw');
        }
    } 
    else if (message.type === 'CLOSE_CLUE') {
        const overlay = document.getElementById('active-clue-overlay');
        overlay.classList.remove('show-overlay');
        
        const existingMedia = document.getElementById('media-container');
        if (existingMedia) existingMedia.remove();
        
        const existingWrapper = document.getElementById('all-media-wrapper');
        if (existingWrapper) existingWrapper.remove();
        
        document.querySelectorAll('.remote-audio').forEach(a => {
            a.pause();
            a.remove();
        });
    }
    else if (message.type === 'UPDATE_SCORES') {
        updatePlayerScoresUI(message.teams);
    }
    else if (message.type === 'SHOW_FJ_CATEGORY') {
        const overlay = document.getElementById('active-clue-overlay');
        const textContainer = document.getElementById('clue-text');
        
        const existingMedia = document.getElementById('media-container');
        if (existingMedia) existingMedia.remove();
        
        const existingWrapper = document.getElementById('all-media-wrapper');
        if (existingWrapper) existingWrapper.remove();

        textContainer.innerHTML = `
            <div style='font-size: 4vw; color: #b0b0b0; text-transform: uppercase; font-weight: 700; letter-spacing: 2px;'>Final Jeopardy Category</div>
            <div style='font-size: 7vw; color: var(--neon-yellow); text-transform: uppercase; font-weight: 900; margin-top: 15px; text-shadow: 0 0 20px rgba(255,204,0,0.5);'>${message.category}</div>
        `;
        overlay.classList.add('show-overlay');
    }
    else if (message.type === 'SHOW_FJ_PROMPT') {
        const overlay = document.getElementById('active-clue-overlay');
        const textContainer = document.getElementById('clue-text');
        
        // Pass FJ Data directly into the standard media renderer
        renderPlayerMedia(message, textContainer, overlay);
        overlay.classList.add('show-overlay');
    }
    else if (message.type === 'SYNC_TIMER') {
        const timerEl = document.getElementById('player-timer');
        timerEl.classList.remove('hidden');
        timerEl.textContent = message.time;
        
        if (message.time <= 0) {
            timerEl.classList.add('time-up');
        } else {
            timerEl.classList.remove('time-up');
        }
    }
    else if (message.type === 'HIDE_TIMER') {
        const timerEl = document.getElementById('player-timer');
        if (timerEl) {
            timerEl.classList.add('hidden');
            timerEl.classList.remove('time-up');
        }
    }
    else if (message.type === 'RESET_GAME') {
        document.querySelectorAll('.cell.points').forEach(cell => cell.classList.remove('answered'));
        document.getElementById('active-clue-overlay').classList.remove('show-overlay');
        
        const existingMedia = document.getElementById('media-container');
        if (existingMedia) existingMedia.remove();
        
        const existingWrapper = document.getElementById('all-media-wrapper');
        if (existingWrapper) existingWrapper.remove();
        
        document.querySelectorAll('.remote-audio').forEach(a => {
            a.pause();
            a.remove();
        });
    }
};

function buildPlayerBoard(data) {
    const board = document.getElementById('game-board');
    board.innerHTML = ''; 

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
            pointsDiv.id = `clue-${col}-${row}`; 
            pointsDiv.textContent = clue.points;
            board.appendChild(pointsDiv);
        }
    }
}

// Extracted UI Logic for rendering both Standard and Final Jeopardy Media
function renderPlayerMedia(message, textContainer, overlay) {
    const existingMedia = document.getElementById('media-container');
    if (existingMedia) existingMedia.remove();
    
    const existingWrapper = document.getElementById('all-media-wrapper');
    if (existingWrapper) existingWrapper.remove();

    if (message.mediaType === 'image' && message.mediaUrl) {
        const urls = message.mediaUrl.split(',').map(u => u.trim());
        const gallery = document.createElement('div');
        gallery.id = 'media-container'; 
        gallery.className = urls.length > 1 ? 'media-gallery' : '';
        
        urls.forEach(url => {
            const img = document.createElement('img');
            img.src = url;
            img.className = urls.length > 1 ? 'clue-image-multi' : 'clue-image';
            gallery.appendChild(img);
        });
        
        overlay.insertBefore(gallery, textContainer);
        textContainer.textContent = message.prompt;
    } 
    else if (message.mediaType === 'video' && message.mediaUrl) {
        const vid = document.createElement('video');
        vid.src = message.mediaUrl;
        vid.autoplay = true;
        vid.className = 'clue-video';
        vid.id = 'media-container'; 
        overlay.insertBefore(vid, textContainer);
        textContainer.textContent = message.prompt;
    }
    else if (message.mediaType === 'audio' && message.mediaUrl) {
        textContainer.innerHTML = "🎧 <em>Waiting for Host to start audio...</em><br><br>" + message.prompt;
    }
    else if (message.mediaType === 'youtube' || message.mediaType === 'spotify') {
        textContainer.innerHTML = "🎧 <em>Listening to Audio Clue...</em><br><br>" + message.prompt;
    }
    else {
        textContainer.innerHTML = message.prompt.replace(/\n/g, '<br>'); 
    }
}

function updatePlayerScoresUI(teams) {
    const scoreBoard = document.getElementById('score-board');
    
    while (scoreBoard.children.length > teams.length) {
        scoreBoard.removeChild(scoreBoard.lastChild);
    }

    while (scoreBoard.children.length < teams.length) {
        const newTeamDiv = document.createElement('div');
        newTeamDiv.className = 'player-team';
        newTeamDiv.innerHTML = `
            <div class="team-name"></div>
            <div class="team-score"></div>
        `;
        scoreBoard.appendChild(newTeamDiv);
    }

    teams.forEach((team, index) => {
        const teamDiv = scoreBoard.children[index];
        if (teamDiv) {
            teamDiv.id = `display-team-${index}`; 
            teamDiv.querySelector('.team-name').textContent = team.name;
            teamDiv.querySelector('.team-score').textContent = team.score;
        }
    });
}