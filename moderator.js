'use strict';
/* Moderator dashboard.
   The server is the source of truth; this page keeps a local copy in `state`
   and re-renders from it (it no longer reads scores back out of the DOM). */

const {
    $, $$, el, normalizeGame, gameRows, clueId, parseClueId, readJsonFile,
    splitUrls, youtubeId, spotifyTrackId, toast, bindConnectionPill, isTyping
} = Common;

const socket = io();
bindConnectionPill(socket, $('#conn-pill'));
const send = msg => socket.emit('game_event', msg);

function remembered(key, fallback) { try { return localStorage.getItem(`mod.${key}`) || fallback; } catch { return fallback; } }
function remember(key, value) { try { localStorage.setItem(`mod.${key}`, value); } catch { /* private mode */ } }

const state = {
    game: null,
    teams: [],
    answered: new Set(),
    activeId: null,        // currently open clue id, e.g. "clue-2-3"
    isDD: false,           // is the open clue the Daily Double?
    stage: 0,              // 0 idle · 1 selected · 2 prompt shown · 3 answer shown
    fjStage: 0,            // 0..3 for Final Jeopardy
    value: 0,              // points the open clue is worth
    order: [],             // buzzer queue (team names)
    buzzersEnabled: false,
    wagers: {},            // team name -> wager
    claimed: [],           // team names that have a phone connected
    ddMode: remembered('ddMode', 'random'), // 'random' | 'manual' | 'none'
    picking: false,        // waiting for the moderator to click a Daily Double tile
    tab: 'clue'
};

/* ======================================================================
   Socket events
   ====================================================================== */
socket.on('game_event', msg => {
    switch (msg.type) {
        case 'SYNC_FULL_STATE': return applySync(msg.state);
        case 'LOAD_GAME':
            state.answered = new Set(); state.wagers = {}; state.picking = false;
            clearClueUI(true);
            return adoptGame(msg.data);
        case 'SET_DAILY_DOUBLE':
            if (state.game) { state.game.dailyDoubleId = msg.id; renderBoardState(); renderDDBar(); }
            return;
        case 'UPDATE_SCORES':
            state.teams = (msg.teams || []).map(t => ({ name: t.name, score: Number(t.score) || 0 }));
            return renderTeams();
        case 'SHOW_PROMPT':
        case 'SHOW_DAILY_DOUBLE':
            if (msg.clueId && state.game && state.activeId !== msg.clueId) {
                const pos = parseClueId(msg.clueId);
                if (pos) {
                    state.answered.add(msg.clueId);
                    showClueDetails(pos.col, pos.row);
                    state.stage = msg.type === 'SHOW_DAILY_DOUBLE' ? 1 : 2;
                    renderAll();
                }
            }
            return;
        case 'SHOW_ANSWER': if (state.activeId) { state.stage = 3; renderClueCard(); } return;
        case 'CLOSE_CLUE': return clearClueUI();
        case 'RESET_GAME': state.answered.clear(); state.teams.forEach(t => t.score = 0); return clearClueUI();
        case 'BUZZER_ORDER': state.order = msg.order || []; return renderBuzzers();
        case 'ENABLE_BUZZERS': state.order = []; state.buzzersEnabled = true; return renderBuzzers();
        case 'DISABLE_BUZZERS': state.buzzersEnabled = false; return renderBuzzers();
        case 'SUBMIT_WAGER': state.wagers[msg.team] = msg.wager; return renderTeams();
        case 'CLEAR_WAGER': delete state.wagers[msg.team]; return renderTeams();
        case 'UPDATE_CLAIMS': state.claimed = msg.claimedTeams || []; return renderTeams();
    }
});

function applySync(s) {
    if (s.gameData) adoptGame(s.gameData, { silent: true });
    else { state.game = null; $('#game-title').textContent = 'No game loaded'; }
    state.answered = new Set(s.answeredClues || []);
    state.teams = (s.teams || []).map(t => ({ name: t.name, score: Number(t.score) || 0 }));
    state.wagers = s.teamWagers || {};
    state.order = s.buzzerOrder || [];
    state.buzzersEnabled = !!s.buzzersEnabled;
    state.claimed = s.claimedTeams || [];

    // Restore whatever was on the big screen when we (re)connected.
    const ov = s.activeOverlay;
    const pos = ov && parseClueId(ov.clueId);
    if (pos && state.game?.categories[pos.col]?.clues[pos.row]) {
        showClueDetails(pos.col, pos.row);
        state.stage = s.answerOverlay ? 3 : (ov.type === 'SHOW_DAILY_DOUBLE' ? 1 : 2);
    } else if (ov && String(ov.type).startsWith('SHOW_FJ')) {
        state.tab = 'final';
        state.fjStage = s.answerOverlay ? 3 : (ov.type === 'SHOW_FJ_PROMPT' ? 2 : 1);
    } else {
        state.activeId = null; state.stage = 0; state.value = 0; state.isDD = false;
    }
    renderAll();
}

/* ======================================================================
   Loading a game
   ====================================================================== */
function adoptGame(data, { silent } = {}) {
    try { normalizeGame(data); } catch (err) { if (!silent) toast(err.message, { type: 'error' }); return; }
    state.game = data;
    if (data.dailyDoubleId === undefined) {           // very old save: pick one now
        data.dailyDoubleId = randomUnplayedCell(data, state.answered);
        send({ type: 'SET_DAILY_DOUBLE', id: data.dailyDoubleId });
    }
    if (data.dailyDoubleId === null) state.ddMode = 'none';
    $('#game-title').textContent = data.gameTitle || 'Untitled game';
    document.title = `Moderator – ${data.gameTitle || 'Trivia Night'}`;
    renderAll();
    renderFinal();
}

async function handleFile(file) {
    if (!file) return;
    try {
        const data = await readJsonFile(file);
        normalizeGame(data);

        // A game file may pre-select the Daily Double (set in the Builder).
        // Without one, behave like before and pick a random tile.
        const preset = Object.prototype.hasOwnProperty.call(data, 'dailyDoubleId');
        if (preset && data.dailyDoubleId === null) state.ddMode = 'none';
        else if (preset && isValidCell(data, data.dailyDoubleId)) state.ddMode = 'manual';
        else { data.dailyDoubleId = randomUnplayedCell(data, new Set()); state.ddMode = 'random'; }

        state.answered = new Set();
        state.wagers = {};
        state.order = [];
        state.picking = false;
        clearClueUI(true);
        adoptGame(data);
        send({ type: 'LOAD_GAME', data });
        broadcastScores();
        toast(`Loaded “${data.gameTitle || 'game'}”`, { type: 'success' });
    } catch (err) {
        toast(err.message || 'Could not load that file.', { type: 'error' });
    }
}

$('#game-file').addEventListener('change', e => { handleFile(e.target.files[0]); e.target.value = ''; });
$('#btn-load').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#game-file').click(); } });

// Drag & drop anywhere on the page
let dragDepth = 0;
const dropOverlay = $('#drop-overlay');
window.addEventListener('dragenter', e => { if (e.dataTransfer?.types?.includes('Files')) { dragDepth++; dropOverlay.hidden = false; } });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; dropOverlay.hidden = true; } });
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => {
    e.preventDefault(); dragDepth = 0; dropOverlay.hidden = true;
    handleFile(e.dataTransfer?.files?.[0]);
});

/* ======================================================================
   Daily Double
   ====================================================================== */
function isValidCell(game, id) {
    const pos = parseClueId(id);
    return !!(pos && game.categories[pos.col]?.clues[pos.row]);
}

function randomUnplayedCell(game, answered) {
    const cells = [];
    game.categories.forEach((cat, col) => cat.clues.forEach((_, row) => {
        const id = clueId(col, row);
        if (!answered.has(id)) cells.push(id);
    }));
    return cells.length ? cells[Math.floor(Math.random() * cells.length)] : null;
}

function setDailyDouble(id, mode) {
    state.game.dailyDoubleId = id;
    if (mode) { state.ddMode = mode; remember('ddMode', mode); }
    state.picking = false;
    send({ type: 'SET_DAILY_DOUBLE', id });
    renderBoardState();
    renderDDBar();
}

$('#dd-mode').addEventListener('click', e => {
    const btn = e.target.closest('button[data-mode]');
    if (!btn || !state.game || state.activeId) return;
    const mode = btn.dataset.mode;
    if (mode === 'random') {
        const id = randomUnplayedCell(state.game, state.answered);
        if (!id) return toast('Every tile has been played.', { type: 'error' });
        setDailyDouble(id, 'random');
        toast('Daily Double re-rolled (only you can see it).');
    } else if (mode === 'manual') {
        state.picking = !state.picking;
        renderBoardState(); renderDDBar();
    } else {
        setDailyDouble(null, 'none');
    }
});
$('#btn-dd-cancel').addEventListener('click', cancelPick);
function cancelPick() { if (state.picking) { state.picking = false; renderBoardState(); renderDDBar(); } }

/* ======================================================================
   Rendering: board
   ====================================================================== */
function renderAll() {
    renderBoard(); renderDDBar(); renderClueCard(); renderTeams(); renderBuzzers(); renderTabs();
}

function renderBoard() {
    const board = $('#mini-board');
    board.innerHTML = '';
    const game = state.game;
    $('#empty-state').hidden = !!game;
    $('#dd-bar').hidden = !game;
    if (!game) { renderBoardState(); return; }

    board.style.setProperty('--cols', game.categories.length);
    game.categories.forEach(cat => board.append(el('div', { class: 'cell category', text: cat.name })));
    for (let row = 0; row < gameRows(game); row++) {
        game.categories.forEach((cat, col) => {
            const clue = cat.clues[row];
            if (!clue) return board.append(el('div', { class: 'cell points missing' }));
            board.append(el('div', {
                class: 'cell points', id: `mod-clue-${col}-${row}`, dataset: { id: clueId(col, row) },
                role: 'button', tabindex: 0, text: String(clue.points),
                title: `${cat.name} – ${clue.points}`,
                onclick: () => onTile(col, row),
                onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTile(col, row); } }
            }));
        });
    }
    renderBoardState();
}

function renderBoardState() {
    const game = state.game;
    const board = $('#mini-board');
    board.classList.toggle('picking', state.picking);
    $('#dd-banner').hidden = !state.picking;
    let total = 0;
    $$('.cell.points[data-id]', board).forEach(cell => {
        const id = cell.dataset.id;
        total++;
        cell.classList.toggle('answered', state.answered.has(id));
        cell.classList.toggle('daily-double-mod', !!game && id === game.dailyDoubleId);
        cell.classList.toggle('active', id === state.activeId);
    });
    const played = [...state.answered].filter(id => $(`[data-id="${id}"]`, board)).length;
    $('#progress').textContent = `${played} / ${total} played`;
}

function renderDDBar() {
    const game = state.game;
    $$('#dd-mode button').forEach(b => {
        const mode = b.dataset.mode;
        b.classList.toggle('active', state.picking ? mode === 'manual' : state.ddMode === mode);
        b.disabled = !game || !!state.activeId;
    });
    const status = $('#dd-status');
    const pos = game && parseClueId(game.dailyDoubleId);
    const clue = pos && game.categories[pos.col]?.clues[pos.row];
    if (state.picking) {
        status.innerHTML = '<b>Waiting for your pick…</b>';
    } else if (clue) {
        status.textContent = 'Hidden from audience · ';
        status.append(el('b', { text: `${game.categories[pos.col].name} – ${clue.points}` }));
    }
    else status.textContent = 'No Daily Double this game';
}

function onTile(col, row) {
    const id = clueId(col, row);
    if (state.picking) {
        if (state.answered.has(id)) return toast('That tile has already been played.', { type: 'error' });
        setDailyDouble(id, 'manual');
        const cat = state.game.categories[col];
        return toast(`Daily Double set: ${cat.name} – ${cat.clues[row].points}`, { type: 'success' });
    }
    if (state.activeId === id) return;
    if (state.activeId) return toast('Close the current clue first (press C).', { type: 'error' });
    if (state.answered.has(id) && !confirm('This clue was already played. Open it again?')) return;
    openClue(col, row);
}

/* ======================================================================
   Clue flow
   ====================================================================== */
function openClue(col, row) {
    const id = clueId(col, row);
    state.answered.add(id);
    showClueDetails(col, row);
    if (state.isDD) {
        state.stage = 1;
        send({ type: 'SHOW_DAILY_DOUBLE', clueId: id });
    } else {
        sendPrompt();
    }
    state.tab = 'clue';
    renderAll();
}

function activeClue() {
    const pos = parseClueId(state.activeId);
    return pos ? state.game.categories[pos.col].clues[pos.row] : null;
}

function showClueDetails(col, row) {
    const cat = state.game.categories[col];
    const clue = cat.clues[row];
    state.activeId = clueId(col, row);
    state.isDD = state.activeId === state.game.dailyDoubleId;
    state.value = state.isDD ? 0 : (parseInt(clue.points, 10) || 0);
    state.stage = Math.max(state.stage, 1);
    state.tab = 'clue';

    $('#current-category').textContent = cat.name;
    const badge = $('#clue-value');
    badge.hidden = false;
    badge.className = 'value-badge' + (state.isDD ? ' dd' : '');
    badge.textContent = state.isDD ? '⭐ DAILY DOUBLE' : clue.points;

    const prompt = $('#mod-prompt-text');
    prompt.className = '';
    prompt.textContent = clue.prompt + (clue.url ? ` (${clue.type.toUpperCase()})` : '');
    const response = $('#mod-response-text');
    response.className = '';
    response.textContent = clue.response;
    renderMedia(clue, $('#mod-media-container'));
    renderMedia({ type: clue.responseType, url: clue.responseUrl }, $('#mod-response-media-container'));
}

function sendPrompt() {
    const clue = activeClue();
    if (!clue) return;
    send({
        type: 'SHOW_PROMPT', clueId: state.activeId, prompt: clue.prompt,
        mediaType: clue.type || 'text', mediaUrl: clue.url || null
    });
    state.stage = Math.max(state.stage, 2);
    // A Daily Double is answered by one team, so the buzzers stay closed.
    if (!state.isDD) openBuzzers(); else lockBuzzers();
}

function revealAnswer() {
    const clue = activeClue();
    if (!clue) return;
    send({
        type: 'SHOW_ANSWER', answer: clue.response,
        responseType: clue.responseType || 'text', responseUrl: clue.responseUrl || ''
    });
    state.stage = 3;
}

function closeClue() {
    send({ type: 'CLOSE_CLUE' });
    send({ type: 'HIDE_TIMER' });
    send({ type: 'DISABLE_BUZZERS' });
    clearClueUI();
}

function clearClueUI(skipRender) {
    state.activeId = null; state.isDD = false; state.stage = 0; state.fjStage = 0; state.value = 0;
    state.wagers = {}; state.order = []; state.buzzersEnabled = false;
    resetTimer(false);
    $('#current-category').textContent = 'No clue selected';
    $('#clue-value').hidden = true;
    const p = $('#mod-prompt-text'); p.className = 'placeholder'; p.textContent = 'Click a tile on the board to begin.';
    const r = $('#mod-response-text'); r.className = 'placeholder'; r.textContent = '…';
    $('#mod-media-container').innerHTML = '';
    $('#mod-response-media-container').innerHTML = '';
    if (!skipRender) renderAll();
}

function renderClueCard() {
    const active = !!state.activeId;
    const s = state.stage;
    $('#dd-alert').hidden = !(active && state.isDD && s < 3);
    renderDDWagerButtons();

    $$('#clue-steps span').forEach(span => {
        const n = +span.dataset.step;
        const current = Math.min(s + 1, 4);
        span.classList.toggle('done', active && n < current);
        span.classList.toggle('current', active && n === current);
    });

    const primary = $('#btn-primary-action');
    primary.className = 'big-action';
    primary.disabled = !active;
    if (!active) { primary.classList.add('btn-primary'); primary.textContent = 'Select a tile to start'; }
    else if (s < 2) { primary.classList.add('btn-primary'); primary.innerHTML = '▶ Show prompt on big screen <kbd>P</kbd>'; }
    else if (s < 3) { primary.classList.add('next-answer'); primary.innerHTML = '👁 Reveal answer <kbd>A</kbd>'; }
    else { primary.classList.add('next-close'); primary.innerHTML = '✓ Close clue &amp; return to board <kbd>C</kbd>'; }

    ['#btn-show-prompt', '#btn-show-answer', '#btn-toggle-zoom', '#btn-close-clue']
        .forEach(sel => $(sel).disabled = !active);
    renderBoardState();
    renderDDBar();
    updateJudge();
}

$('#btn-primary-action').addEventListener('click', () => {
    if (state.stage < 2) sendPrompt(); else if (state.stage < 3) revealAnswer(); else return closeClue();
    renderClueCard();
});
$('#btn-show-prompt').addEventListener('click', () => { sendPrompt(); renderClueCard(); });
$('#btn-show-answer').addEventListener('click', () => { revealAnswer(); renderClueCard(); });
$('#btn-close-clue').addEventListener('click', closeClue);
$('#btn-toggle-zoom').addEventListener('click', () => send({ type: 'TOGGLE_ZOOM' }));
$('#btn-fj-toggle-zoom').addEventListener('click', () => send({ type: 'TOGGLE_ZOOM' }));

/* ======================================================================
   Media preview (moderator side)
   ====================================================================== */
function renderMedia(clue, container) {
    container.innerHTML = '';
    if (!clue || !clue.type || clue.type === 'text' || !clue.url) return;
    const { type, url } = clue;

    if (type === 'image') {
        const row = el('div', { class: 'img-row' });
        splitUrls(url).forEach(u => row.append(el('img', { src: u, alt: 'Clue image', loading: 'lazy' })));
        container.append(row);
    } else if (type === 'video') {
        container.append(el('video', { src: url, controls: true, preload: 'metadata' }));
    } else if (type === 'audio') {
        const urls = splitUrls(url);
        urls.forEach((u, i) => {
            const label = `🔊 Play on big screen${urls.length > 1 ? ` (${i + 1})` : ''}`;
            const btn = el('button', { class: 'primary btn-block', text: label });
            btn.addEventListener('click', () => {
                send({ type: 'PLAY_AUDIO_REMOTE', url: u });
                btn.textContent = '🔊 Playing…';
                btn.classList.replace('primary', 'success');
                setTimeout(() => { btn.textContent = label; btn.classList.replace('success', 'primary'); }, 2000);
            });
            container.append(el('div', { class: 'audio-item' }, el('audio', { src: u, controls: true }), btn));
        });
    } else if (type === 'spotify') {
        const id = spotifyTrackId(url);
        if (id) container.append(el('iframe', {
            src: `https://open.spotify.com/embed/track/${id}?utm_source=generator&theme=0`, height: 152,
            allow: 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture'
        }));
    } else if (type === 'youtube') {
        const id = youtubeId(url);
        if (id) container.append(el('iframe', {
            src: `https://www.youtube.com/embed/${id}?controls=1`, height: 200, allowfullscreen: true,
            allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture'
        }));
    }
}

/* ======================================================================
   Final Jeopardy
   ====================================================================== */
function renderFinal() {
    const fj = state.game?.finalJeopardy;
    const set = (sel, text) => { const n = $(sel); n.textContent = text || '…'; n.classList.toggle('placeholder', !text); };
    set('#mod-fj-category-text', fj?.category);
    set('#mod-fj-prompt-text', fj?.prompt);
    set('#mod-fj-answer-text', fj?.answer);
    if (!fj) $('#mod-fj-prompt-text').textContent = 'This game has no Final Jeopardy.';
    renderMedia(fj ? { type: fj.type, url: fj.url } : null, $('#mod-fj-media-container'));
    renderMedia(fj ? { type: fj.responseType, url: fj.responseUrl } : null, $('#mod-fj-response-media-container'));
}

function renderFJButtons() {
    [['#btn-fj-category', 1], ['#btn-fj-prompt', 2], ['#btn-fj-answer', 3]].forEach(([sel, n]) =>
        $(sel).classList.toggle('done', state.fjStage >= n));
}

$('#btn-fj-category').addEventListener('click', () => {
    send({ type: 'SHOW_FJ_CATEGORY', category: state.game?.finalJeopardy?.category || 'Final Jeopardy' });
    state.fjStage = Math.max(state.fjStage, 1); state.value = 0; renderFJButtons();
});
$('#btn-fj-prompt').addEventListener('click', () => {
    const fj = state.game?.finalJeopardy;
    if (!fj) return toast('This game has no Final Jeopardy.', { type: 'error' });
    send({ type: 'SHOW_FJ_PROMPT', prompt: fj.prompt || '...', mediaType: fj.type || 'text', mediaUrl: fj.url || null });
    state.fjStage = Math.max(state.fjStage, 2); renderFJButtons();
});
$('#btn-fj-answer').addEventListener('click', () => {
    const fj = state.game?.finalJeopardy;
    send({
        type: 'SHOW_FJ_ANSWER', answer: fj?.answer || '...',
        responseType: fj?.responseType || 'text', responseUrl: fj?.responseUrl || ''
    });
    state.fjStage = 3; renderFJButtons();
});
$('#btn-fj-close').addEventListener('click', closeClue);
$('#btn-fj-wagers').addEventListener('click', () => {
    if (!state.teams.length) return;
    state.teams.forEach(t => send({ type: 'REQUEST_WAGER', team: t.name }));
    toast('Wager request sent to every phone.');
});

/* ======================================================================
   Tabs
   ====================================================================== */
function renderTabs() {
    $$('.tabs button[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === state.tab));
    $('#tab-clue').hidden = state.tab !== 'clue';
    $('#tab-final').hidden = state.tab !== 'final';
    renderFJButtons();
}
$('.tabs').addEventListener('click', e => {
    const b = e.target.closest('button[data-tab]');
    if (b) { state.tab = b.dataset.tab; renderTabs(); }
});

/* ======================================================================
   Teams & scores
   ====================================================================== */
const teamRows = [];
let scoreTimer;

function broadcastScores() {
    clearTimeout(scoreTimer);
    send({ type: 'UPDATE_SCORES', teams: state.teams.map(({ name, score }) => ({ name, score })) });
}
const scheduleScoreBroadcast = () => { clearTimeout(scoreTimer); scoreTimer = setTimeout(broadcastScores, 300); };

function wagerFor(team) { return state.wagers[team.name]; }
function amountFor(team) { const w = wagerFor(team); return w !== undefined ? Number(w) || 0 : state.value; }

function award(i, sign) {
    const team = state.teams[i];
    if (!team) return;
    team.score += sign * amountFor(team);
    broadcastScores();
    updateTeamRow(i);
}

function buildTeamRow(i) {
    const row = {};
    row.name = el('input', {
        type: 'text', 'aria-label': 'Team name',
        oninput: () => { state.teams[i].name = row.name.value; scheduleScoreBroadcast(); }
    });
    row.phone = el('span', { class: 'phone', text: '📱', title: 'A phone has joined as this team' });
    row.chip = el('span', { class: 'wager-chip' });
    row.minus = el('button', { class: 'award minus', onclick: () => award(i, -1) });
    row.plus = el('button', { class: 'award plus', onclick: () => award(i, +1) });
    row.score = el('input', {
        type: 'number', class: 'score', 'aria-label': 'Score',
        onchange: () => { state.teams[i].score = parseInt(row.score.value, 10) || 0; broadcastScores(); updateTeamRow(i); }
    });
    row.bonus = el('button', {
        text: '＋ Bonus', title: 'Add the Bonus amount from the box above',
        onclick: () => {
            const bonus = parseInt($('#bonus-input').value, 10) || 0;
            if (!bonus) return toast('Type a bonus amount first.', { type: 'error' });
            state.teams[i].score += bonus; broadcastScores(); updateTeamRow(i);
        }
    });
    row.ask = el('button', {
        text: '💰 Ask wager', title: 'Ask this team’s phone for a wager',
        onclick: () => { send({ type: 'REQUEST_WAGER', team: state.teams[i].name }); toast(`Wager requested from ${state.teams[i].name}`); }
    });
    row.clear = el('button', {
        text: '✕ Clear wager',
        onclick: () => { const n = state.teams[i].name; delete state.wagers[n]; send({ type: 'CLEAR_WAGER', team: n }); renderTeams(); }
    });
    row.unclaim = el('button', {
        text: '🔓 Unclaim', title: 'Kick this team’s phone back to the join screen',
        onclick: () => { const n = state.teams[i].name; if (confirm(`Force the phone on “${n}” to rejoin?`)) send({ type: 'UNCLAIM_TEAM', team: n }); }
    });
    row.remove = el('button', {
        class: 'remove-team', text: 'Remove', title: 'Remove this team',
        onclick: () => {
            const t = state.teams[i];
            if (!confirm(`Remove “${t.name}”?`)) return;
            send({ type: 'UNCLAIM_TEAM', team: t.name });
            state.teams.splice(i, 1);
            broadcastScores(); renderTeams();
        }
    });
    row.root = el('div', { class: 'team' },
        el('div', { class: 'team-id' }, row.phone, row.name, row.chip),
        el('div', { class: 'score-controls' }, row.minus, row.score, row.plus),
        el('div', { class: 'team-tools' }, row.bonus, row.ask, row.clear, row.unclaim, row.remove)
    );
    return row;
}

function updateTeamRow(i) {
    const team = state.teams[i], row = teamRows[i];
    if (!team || !row) return;
    if (document.activeElement !== row.name) row.name.value = team.name;
    if (document.activeElement !== row.score) row.score.value = team.score;
    row.score.classList.toggle('negative', team.score < 0);

    const wager = wagerFor(team);
    const amount = amountFor(team);
    row.chip.hidden = wager === undefined;
    row.chip.textContent = `Wager ${wager}`;
    row.clear.hidden = wager === undefined;
    row.plus.textContent = amount ? `+${amount}` : '＋';
    row.minus.textContent = amount ? `−${amount}` : '−';
    row.plus.title = amount ? `Award ${amount} points` : 'No clue open: use the score box or Bonus';
    row.minus.title = amount ? `Deduct ${amount} points` : 'No clue open: use the score box or Bonus';

    const claimed = state.claimed.includes(team.name);
    row.phone.classList.toggle('on', claimed);
    row.unclaim.hidden = !claimed;
    row.root.classList.toggle('buzzed', state.order[0] === team.name);
}

function renderTeams() {
    const list = $('#team-list');
    while (teamRows.length > state.teams.length) teamRows.pop().root.remove();
    while (teamRows.length < state.teams.length) {
        const row = buildTeamRow(teamRows.length);
        teamRows.push(row); list.append(row.root);
    }
    state.teams.forEach((_, i) => updateTeamRow(i));
    if (!state.teams.length && !list.querySelector('.empty')) list.append(el('p', { class: 'hint empty', text: 'No teams yet — add one below.' }));
    else if (state.teams.length) list.querySelector('.empty')?.remove();
    renderDDWagerButtons();
    updateJudge();
}

$('#btn-add-team').addEventListener('click', () => {
    let n = state.teams.length + 1;
    while (state.teams.some(t => t.name === `Team ${n}`)) n++;
    state.teams.push({ name: `Team ${n}`, score: 0 });
    broadcastScores(); renderTeams();
});

$('#btn-reset-claims').addEventListener('click', () => {
    if (confirm('Send every phone back to the team-selection screen?')) send({ type: 'RESET_CLAIMS' });
});

function renderDDWagerButtons() {
    const box = $('#dd-wager-buttons');
    box.innerHTML = '';
    state.teams.forEach(t => box.append(el('button', {
        class: 'warn sm', text: `💰 ${t.name}`, title: `Ask ${t.name} for a wager`,
        onclick: () => { send({ type: 'REQUEST_WAGER', team: t.name }); toast(`Wager requested from ${t.name}`); }
    })));
}

/* ======================================================================
   Buzzers
   ====================================================================== */
function openBuzzers() { state.order = []; state.buzzersEnabled = true; send({ type: 'ENABLE_BUZZERS' }); renderBuzzers(); }
function lockBuzzers() { state.buzzersEnabled = false; send({ type: 'DISABLE_BUZZERS' }); renderBuzzers(); }
function setOrder(order) { state.order = order; send({ type: 'BUZZER_ORDER', order }); renderBuzzers(); }

function renderBuzzers() {
    const list = $('#buzzer-list');
    list.innerHTML = '';
    if (!state.order.length) list.append(el('li', { class: 'empty', text: state.buzzersEnabled ? 'Waiting for a buzz…' : 'No buzzes yet.' }));
    state.order.forEach((team, i) => list.append(el('li', {}, el('span', { class: 'rank', text: i + 1 }), team)));
    const pill = $('#buzzer-state');
    pill.textContent = state.buzzersEnabled ? 'Open' : 'Locked';
    pill.classList.toggle('open', state.buzzersEnabled);
    $('#btn-next-buzzer').disabled = !state.order.length;
    $('#btn-lock-buzzers').disabled = !state.buzzersEnabled;
    state.teams.forEach((_, i) => updateTeamRow(i));
    updateJudge();
}

function updateJudge() {
    const first = state.order[0];
    const idx = state.teams.findIndex(t => t.name === first);
    const show = idx >= 0 && !!state.activeId;
    $('#judge-row').hidden = !show;
    if (!show) return;
    const amount = amountFor(state.teams[idx]);
    $('#btn-judge-correct').textContent = `✓ ${first} correct${amount ? ` (+${amount})` : ''}`;
    $('#btn-judge-wrong').textContent = `✗ Wrong${amount ? ` (−${amount})` : ''}`;
}

$('#btn-judge-correct').addEventListener('click', () => {
    const idx = state.teams.findIndex(t => t.name === state.order[0]);
    if (idx < 0) return;
    award(idx, +1);
    state.order = []; send({ type: 'BUZZER_ORDER', order: [] });
    lockBuzzers();
    if (state.stage < 3) { revealAnswer(); renderClueCard(); }
});
$('#btn-judge-wrong').addEventListener('click', () => {
    const idx = state.teams.findIndex(t => t.name === state.order[0]);
    if (idx < 0) return;
    award(idx, -1);
    setOrder(state.order.slice(1));
});
$('#btn-next-buzzer').addEventListener('click', () => { if (state.order.length) setOrder(state.order.slice(1)); });
$('#btn-clear-buzzers').addEventListener('click', openBuzzers);
$('#btn-lock-buzzers').addEventListener('click', lockBuzzers);

/* ======================================================================
   Timer (uses a wall-clock deadline, so it never drifts)
   ====================================================================== */
const timer = { remaining: 30, endAt: 0, handle: null, paused: false };
const timerInput = $('#timer-input');
const timerDisplay = $('#mod-timer-display');
const timerSecs = () => Math.max(1, parseInt(timerInput.value, 10) || 30);

function showTimer(n) { timerDisplay.textContent = n; timerDisplay.classList.toggle('low', n > 0 && n <= 5); }

function startTimer() {
    if (timer.handle) return;
    if (!timer.paused || timer.remaining <= 0) timer.remaining = timerSecs();
    timer.paused = false;
    timer.endAt = Date.now() + timer.remaining * 1000;
    let last = timer.remaining;
    showTimer(last);
    send({ type: 'SYNC_TIMER', time: last });
    timer.handle = setInterval(() => {
        const rem = Math.max(0, Math.ceil((timer.endAt - Date.now()) / 1000));
        if (rem !== last) { last = rem; timer.remaining = rem; showTimer(rem); send({ type: 'SYNC_TIMER', time: rem }); }
        if (rem <= 0) { clearInterval(timer.handle); timer.handle = null; }
    }, 200);
}

function pauseTimer() {
    if (!timer.handle) return;
    clearInterval(timer.handle); timer.handle = null;
    timer.remaining = Math.max(0, Math.ceil((timer.endAt - Date.now()) / 1000));
    timer.paused = timer.remaining > 0;
}

function resetTimer(notify = true) {
    clearInterval(timer.handle); timer.handle = null; timer.paused = false;
    timer.remaining = timerSecs();
    showTimer(timer.remaining);
    if (notify) send({ type: 'HIDE_TIMER' });
}

const toggleTimer = () => timer.handle ? pauseTimer() : startTimer();
$('#btn-start-timer').addEventListener('click', startTimer);
$('#btn-stop-timer').addEventListener('click', pauseTimer);
$('#btn-reset-timer').addEventListener('click', () => resetTimer(true));
timerInput.addEventListener('input', () => { if (!timer.handle && !timer.paused) resetTimer(false); });
$('#timer-presets').addEventListener('click', e => {
    const b = e.target.closest('button[data-secs]');
    if (b) { timerInput.value = b.dataset.secs; resetTimer(false); }
});

/* ======================================================================
   Header buttons
   ====================================================================== */
$('#open-player-window').addEventListener('click', () => window.open('player.html', '_blank'));
$('#btn-force-sync').addEventListener('click', () => { send({ type: 'FORCE_SYNC' }); toast('Every screen re-synced.', { type: 'success' }); });

$('#btn-copy-buzzer').addEventListener('click', async () => {
    let url = `${location.origin}/buzzer.html`;
    try { const info = await (await fetch('/lan-info')).json(); if (info.buzzer) url = info.buzzer; } catch { /* keep default */ }
    try { await navigator.clipboard.writeText(url); toast(`Copied: ${url}`, { type: 'success', ms: 5000 }); }
    catch { window.prompt('Players open this link on their phones:', url); }
});

$('#btn-reset-game').addEventListener('click', () => {
    if (!state.game) return;
    if (!confirm('Reset the game?\n\nThis clears all board progress and sets every score back to 0.')) return;
    send({ type: 'HIDE_TIMER' });
    send({ type: 'DISABLE_BUZZERS' });
    send({ type: 'RESET_GAME' });
    state.answered.clear();
    state.teams.forEach(t => t.score = 0);
    clearClueUI(true);
    broadcastScores();
    if (state.ddMode === 'random') {
        state.game.dailyDoubleId = randomUnplayedCell(state.game, state.answered);
        send({ type: 'SET_DAILY_DOUBLE', id: state.game.dailyDoubleId });
    }
    renderAll();
    toast('Game reset.', { type: 'success' });
});

/* ======================================================================
   Keyboard shortcuts
   ====================================================================== */
document.addEventListener('keydown', e => {
    if (isTyping() || e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === 'escape') return cancelPick();
    if (key === 't') { e.preventDefault(); return toggleTimer(); }
    if (state.tab !== 'clue' || !state.activeId) return;
    if (key === 'p') { sendPrompt(); renderClueCard(); }
    else if (key === 'a') { revealAnswer(); renderClueCard(); }
    else if (key === 'c') closeClue();
    else if (key === 'z') send({ type: 'TOGGLE_ZOOM' });
});

/* ======================================================================
   Initial paint
   ====================================================================== */
renderAll();
resetTimer(false);
