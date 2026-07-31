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
gameChannel.postMessage({ type: 'PLAYER_READY' });

gameChannel.onmessage = (event) => {
    const message = event.data;

    if (message.type === 'LOAD_GAME') {
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
        
        const existingMedia = document.getElementById('media-container');
        if (existingMedia) existingMedia.remove();

        if (message.mediaType === 'image' && message.mediaUrl) {
            // Split by comma to support multiple images
            const urls = message.mediaUrl.split(',').map(u => u.trim());
            const gallery = document.createElement('div');
            gallery.id = 'media-container'; // Use the same ID so existing cleanup works
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
            // Add a video player that auto-plays
            const vid = document.createElement('video');
            vid.src = message.mediaUrl;
            vid.autoplay = true;
            vid.className = 'clue-video';
            vid.id = 'media-container'; 
            overlay.insertBefore(vid, textContainer);
            textContainer.textContent = message.prompt;
        }
        else if (message.mediaType === 'audio' && message.mediaUrl) {
            // Add an invisible audio player that auto-plays
            const aud = document.createElement('audio');
            aud.src = message.mediaUrl;
            aud.autoplay = true;
            aud.id = 'media-container';
            aud.style.display = 'none'; 
            overlay.insertBefore(aud, textContainer);
            textContainer.innerHTML = "🎧 <em>Listening to Audio Clue...</em><br><br>" + message.prompt;
        }
        else if (message.mediaType === 'youtube' || message.mediaType === 'spotify') {
            textContainer.innerHTML = "🎧 <em>Listening to Audio Clue...</em><br><br>" + message.prompt;
        }
        else if (message.type === 'RESET_GAME') {
            document.querySelectorAll('.cell.points').forEach(cell => {
                cell.classList.remove('answered');
            });
            
            document.getElementById('active-clue-overlay').classList.remove('show-overlay');
            
            const existingMedia = document.getElementById('media-container');
            if (existingMedia) existingMedia.remove();
        }
        else {
            textContainer.innerHTML = message.prompt.replace(/\n/g, '<br>'); 
        }

        overlay.classList.add('show-overlay');
    }
    else if (message.type === 'SHOW_ANSWER') {
        document.getElementById('clue-text').textContent = message.answer;
    } 
    else if (message.type === 'CLOSE_CLUE') {
        const overlay = document.getElementById('active-clue-overlay');
        overlay.classList.remove('show-overlay');
        
        const existingMedia = document.getElementById('media-container');
        if (existingMedia) existingMedia.remove();
    }
    else if (message.type === 'UPDATE_SCORES') {
        const scoreBoard = document.getElementById('score-board');
        
        while (scoreBoard.children.length > message.teams.length) {
            scoreBoard.removeChild(scoreBoard.lastChild);
        }

        while (scoreBoard.children.length < message.teams.length) {
            const newTeamDiv = document.createElement('div');
            newTeamDiv.className = 'player-team';
            newTeamDiv.innerHTML = `
                <div class="team-name"></div>
                <div class="team-score"></div>
            `;
            scoreBoard.appendChild(newTeamDiv);
        }

        message.teams.forEach((team, index) => {
            const teamDiv = scoreBoard.children[index];
            if (teamDiv) {
                teamDiv.id = `display-team-${index}`; 
                teamDiv.querySelector('.team-name').textContent = team.name;
                teamDiv.querySelector('.team-score').textContent = team.score;
            }
        });
    }
    else if (message.type === 'SHOW_FJ_CATEGORY') {
        const overlay = document.getElementById('active-clue-overlay');
        const textContainer = document.getElementById('clue-text');
        
        const existingMedia = document.getElementById('media-container');
        if (existingMedia) existingMedia.remove();

        textContainer.innerHTML = `
            <div style='font-size: 4vw; color: #b0b0b0; text-transform: uppercase; font-weight: 700; letter-spacing: 2px;'>Final Jeopardy Category</div>
            <div style='font-size: 7vw; color: var(--neon-yellow); text-transform: uppercase; font-weight: 900; margin-top: 15px; text-shadow: 0 0 20px rgba(255,204,0,0.5);'>${message.category}</div>
        `;
        overlay.classList.add('show-overlay');
    }
    else if (message.type === 'SHOW_FJ_PROMPT') {
        const overlay = document.getElementById('active-clue-overlay');
        const textContainer = document.getElementById('clue-text');
        
        textContainer.innerHTML = message.prompt.replace(/\n/g, '<br>');
        overlay.classList.add('show-overlay');
    }
    else if (message.type === 'SHOW_FJ_ANSWER') {
        const textContainer = document.getElementById('clue-text');
        
        textContainer.innerHTML += `<br><br><span style="color: #10b981; font-size: 4vw; text-shadow: 0 0 15px rgba(16, 185, 129, 0.5);">${message.answer.replace(/\n/g, '<br>')}</span>`;
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