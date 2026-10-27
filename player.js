'use strict';
/* Big screen (audience view). Purely reactive: it renders whatever the
   moderator sends, and restores everything from the server on (re)connect. */

const { safeHtml, normalizeGame, gameRows, clueId, splitUrls } = Common;
const socket = io();

const $id = id => document.getElementById(id);
const overlay = $id('active-clue-overlay');
const clueText = $id('clue-text');
const answerText = $id('answer-text');

socket.on('game_event', handleMessage);

function handleMessage(message) {
    switch (message.type) {
        case 'SYNC_FULL_STATE': return restore(message.state);
        case 'LOAD_GAME': closeOverlay(); return buildBoard(message.data);
        case 'SHOW_DAILY_DOUBLE': return showDailyDouble(message);
        case 'SHOW_PROMPT': return showPrompt(message);
        case 'SHOW_ANSWER':
        case 'SHOW_FJ_ANSWER': return showAnswer(message);
        case 'SHOW_FJ_CATEGORY': return showFinalCategory(message);
        case 'SHOW_FJ_PROMPT': return showPrompt(message);
        case 'PLAY_AUDIO_REMOTE': return playRemoteAudio(message.url);
        case 'TOGGLE_ZOOM': return overlay.querySelectorAll('img').forEach(img => img.classList.toggle('zoomed'));
        case 'CLOSE_CLUE': return closeOverlay();
        case 'UPDATE_SCORES': return renderScores(message.teams);
        case 'SYNC_TIMER': return showTimer(message.time);
        case 'HIDE_TIMER': return hideTimer();
        case 'RESET_GAME':
            document.querySelectorAll('.cell.points').forEach(cell => cell.classList.remove('answered'));
            return closeOverlay();
    }
}

/* ---------- Restore after (re)connect ---------- */
function restore(state) {
    if (state.gameData) {
        buildBoard(state.gameData);
        (state.answeredClues || []).forEach(id => $id(id)?.classList.add('answered'));
    }
    if (state.teams) renderScores(state.teams);

    // Replay what was on screen, so a refreshed projector picks up mid-clue.
    if (state.activeOverlay) {
        handleMessage(state.activeOverlay);
        if (state.answerOverlay) handleMessage(state.answerOverlay);
    } else {
        closeOverlay();
    }
}

/* ---------- Board ---------- */
function buildBoard(data) {
    normalizeGame(data);
    const board = $id('game-board');
    board.innerHTML = '';
    board.style.setProperty('--cols', data.categories.length);
    board.style.setProperty('--rows', gameRows(data));

    data.categories.forEach(category => {
        const cell = document.createElement('div');
        cell.className = 'cell category';
        cell.textContent = category.name;
        board.appendChild(cell);
    });

    for (let row = 0; row < gameRows(data); row++) {
        data.categories.forEach((category, col) => {
            const clue = category.clues[row];
            const cell = document.createElement('div');
            cell.className = 'cell points';
            if (clue) {
                cell.id = clueId(col, row);
                cell.textContent = clue.points;
            } else {
                cell.style.visibility = 'hidden';
            }
            board.appendChild(cell);
        });
    }
}

/* ---------- Overlay helpers ---------- */
function clearMedia() {
    $id('media-container')?.remove();
    $id('all-media-wrapper')?.remove();
    answerText.innerHTML = '';
    overlay.querySelectorAll('.remote-audio').forEach(a => { a.pause(); a.remove(); });
}

function openOverlay() { overlay.classList.add('show-overlay'); }

function closeOverlay() {
    overlay.classList.remove('show-overlay');
    clearMedia();
}

function markPlayed(id) { if (id) $id(id)?.classList.add('answered'); }

function showDailyDouble(message) {
    markPlayed(message.clueId);
    clearMedia();
    clueText.innerHTML = '<div class="splash-dd">Daily Double</div>';
    openOverlay();
}

function showFinalCategory(message) {
    clearMedia();
    clueText.innerHTML = `
        <div class="fj-label">Final Jeopardy Category</div>
        <div class="fj-category">${safeHtml(message.category)}</div>`;
    openOverlay();
}

function showPrompt(message) {
    markPlayed(message.clueId);
    clearMedia();
    renderPrompt(message);
    openOverlay();
}

/* Prompt text + any image / video / audio indicator */
function renderPrompt(message) {
    const { mediaType, mediaUrl } = message;
    const prompt = message.prompt || '';

    if (mediaType === 'image' && mediaUrl) {
        const urls = splitUrls(mediaUrl);
        const gallery = document.createElement('div');
        gallery.id = 'media-container';
        if (urls.length > 1) gallery.className = 'media-gallery';
        urls.forEach(url => {
            const img = document.createElement('img');
            img.src = url;
            img.className = urls.length > 1 ? 'clue-image-multi' : 'clue-image';
            img.addEventListener('click', () => img.classList.toggle('zoomed'));
            gallery.appendChild(img);
        });
        overlay.insertBefore(gallery, clueText);
        clueText.innerHTML = safeHtml(prompt);
    } else if (mediaType === 'video' && mediaUrl) {
        const vid = document.createElement('video');
        vid.src = mediaUrl;
        vid.autoplay = true;
        vid.className = 'clue-video';
        vid.id = 'media-container';
        overlay.insertBefore(vid, clueText);
        clueText.innerHTML = safeHtml(prompt);
    } else if (mediaType === 'audio' && mediaUrl) {
        clueText.innerHTML = '🎧 <em>Waiting for Host to start audio...</em><br><br>' + safeHtml(prompt);
    } else if (mediaType === 'youtube' || mediaType === 'spotify') {
        clueText.innerHTML = '🎧 <em>Listening to Audio Clue...</em><br><br>' + safeHtml(prompt);
    } else {
        clueText.innerHTML = safeHtml(prompt);
    }
}

/* Answer text, plus optional answer media shown beside the prompt media */
function showAnswer(message) {
    answerText.innerHTML = safeHtml(message.answer || '...');
    openOverlay();

    const { responseType, responseUrl } = message;
    if (!responseType || responseType === 'text' || !responseUrl) return;

    let wrapper = $id('all-media-wrapper');
    if (!wrapper) {
        wrapper = document.createElement('div');
        wrapper.id = 'all-media-wrapper';
        const promptMedia = $id('media-container');
        overlay.insertBefore(wrapper, promptMedia || clueText);
        if (promptMedia) wrapper.appendChild(promptMedia);
    }
    $id('response-media-container')?.remove();

    const box = document.createElement('div');
    box.id = 'response-media-container';
    if (responseType === 'image') {
        splitUrls(responseUrl).forEach(url => {
            const img = document.createElement('img');
            img.src = url;
            img.className = 'clue-image-multi answer-media';
            img.addEventListener('click', () => img.classList.toggle('zoomed'));
            box.appendChild(img);
        });
    } else if (responseType === 'video') {
        const vid = document.createElement('video');
        vid.src = responseUrl;
        vid.autoplay = true;
        vid.controls = true;
        vid.className = 'clue-video answer-media';
        box.appendChild(vid);
    }
    wrapper.appendChild(box);

    // Shrink the prompt media so both fit side by side.
    wrapper.querySelectorAll('.clue-image').forEach(img => { img.className = 'clue-image-multi'; });
    wrapper.querySelectorAll('.clue-video:not(.answer-media)').forEach(v => { v.style.maxWidth = '40vw'; });
}

function playRemoteAudio(url) {
    const audio = document.createElement('audio');
    audio.src = url;
    audio.autoplay = true;
    audio.className = 'remote-audio';
    audio.style.display = 'none';
    overlay.appendChild(audio);
}

/* ---------- Timer ---------- */
function showTimer(time) {
    const el = $id('player-timer');
    el.classList.remove('hidden');
    el.textContent = time;
    el.classList.toggle('time-up', time <= 0);
}

function hideTimer() {
    const el = $id('player-timer');
    el.classList.add('hidden');
    el.classList.remove('time-up');
}

/* ---------- Scores ---------- */
function renderScores(teams) {
    const board = $id('score-board');
    while (board.children.length > teams.length) board.lastChild.remove();
    while (board.children.length < teams.length) {
        const div = document.createElement('div');
        div.className = 'player-team';
        div.innerHTML = '<div class="team-name"></div><div class="team-score"></div>';
        board.appendChild(div);
    }
    teams.forEach((team, i) => {
        const div = board.children[i];
        div.id = `display-team-${i}`;
        div.querySelector('.team-name').textContent = team.name;
        div.querySelector('.team-score').textContent = team.score;
    });
}
