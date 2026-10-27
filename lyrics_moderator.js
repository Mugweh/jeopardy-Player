'use strict';
/* Lyrics-game moderator. All state lives on the server; this page renders it. */

const { $, el, readJsonFile, toast, bindConnectionPill, isTyping } = Common;

const socket = io();
bindConnectionPill(socket, $('#conn-pill'));
const send = msg => socket.emit('game_event', msg);

let lyricsState = null;
let sharedTeams = [];
let claimed = [];

socket.on('game_event', data => {
    switch (data.type) {
        case 'SYNC_FULL_STATE':
            sharedTeams = data.state.teams || [];
            claimed = data.state.claimedTeams || [];
            if (data.state.lyricsState) lyricsState = data.state.lyricsState;
            return render();
        case 'SYNC_LYRICS_STATE':
        case 'UPDATE_LYRICS_STATE':
            lyricsState = data.state;
            return render();
        case 'UPDATE_SCORES': sharedTeams = data.teams || []; return render();
        case 'UPDATE_CLAIMS': claimed = data.claimedTeams || []; return render();
    }
});

$('#lyrics-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
        const data = await readJsonFile(file);
        if (!Array.isArray(data.rounds)) throw new Error('This file has no "rounds" list, so it isn’t a lyrics pack.');
        // Older packs stored a single string instead of a list of snippets.
        data.rounds.forEach(r => { if (typeof r.lyrics === 'string') r.lyrics = [r.lyrics]; });
        send({ type: 'LOAD_LYRICS_GAME', data });
        toast(`Loaded “${data.title || 'lyrics pack'}”.`, { type: 'success' });
    } catch (err) {
        toast(err.message, { type: 'error' });
    }
});

function setText(sel, text, placeholder) {
    const n = $(sel);
    n.textContent = text || placeholder;
    n.classList.toggle('placeholder', !text);
}

function render() {
    const game = lyricsState?.gameData;
    $('#pack-title').textContent = game ? (game.title || 'Untitled pack') : 'No pack loaded';
    if (!game) return renderTeams();

    const rIdx = lyricsState.currentRound;
    const round = game.rounds[rIdx];
    const hints = lyricsState.hintsRevealed || 0;

    $('#round-status').textContent = round
        ? `Round ${rIdx + 1} of ${game.rounds.length} · worth ${4 - hints} pt${4 - hints === 1 ? '' : 's'}`
        : 'Game over';

    const snippets = round?.lyrics || [];
    const sIdx = lyricsState.currentLyricSection || 0;
    $('#snippet-tracker').textContent = `Snippet ${snippets.length ? sIdx + 1 : 0} of ${snippets.length}`;
    setText('#mod-lyrics-text', snippets.length ? (snippets[sIdx] || '(empty snippet)') : '', round ? 'No lyrics in this round.' : 'All rounds finished.');
    setText('#mod-answer-text', round?.answer, '…');

    $('#btn-prev-snippet').disabled = sIdx <= 0;
    $('#btn-next-snippet').disabled = sIdx >= snippets.length - 1;
    $('#btn-reveal-hint').disabled = hints >= 3 || !round;
    $('#btn-reveal-answer').disabled = !round || !!lyricsState.answerRevealed;
    $('#btn-prev-round').disabled = rIdx <= 0;
    $('#btn-next-round').disabled = !round;

    const stages = $('#hint-stages');
    stages.innerHTML = '';
    for (let i = 1; i <= 3; i++) stages.append(el('span', { class: i <= hints ? 'on' : '', text: `Hint ${i}${i <= hints ? ' ✓' : ''}` }));

    renderSubmissions(lyricsState.submissions || {});
    renderTeams();
}

function renderSubmissions(subs) {
    const list = $('#submissions-list');
    list.innerHTML = '';
    const teams = Object.keys(subs);
    if (!teams.length) return list.append(el('p', { class: 'hint', text: 'No submissions yet this round.' }));

    teams.forEach(team => {
        const entry = subs[team];
        const pts = 4 - entry.stage;
        const status = (entry.status || 'PENDING').toLowerCase();
        list.append(el('div', { class: `submission ${status}` },
            el('div', {},
                el('strong', { style: 'color:var(--gold)', text: team }),
                el('span', { class: 'hint', text: `  locked in after ${entry.stage} hint${entry.stage === 1 ? '' : 's'} · worth ${pts}` }),
                el('div', { class: 'answer', text: `“${entry.answer}”` }),
                el('div', { class: `status-tag ${status}`, text: status })
            ),
            el('div', { style: 'display:flex; gap:.4rem' },
                el('button', { class: 'success sm', text: `✓ +${pts}`, disabled: status === 'correct', onclick: () => send({ type: 'GRADE_LYRICS_SUBMISSION', team, isCorrect: true }) }),
                el('button', { class: 'danger sm', text: `✗ −${pts}`, disabled: status === 'incorrect', onclick: () => send({ type: 'GRADE_LYRICS_SUBMISSION', team, isCorrect: false }) })
            )
        ));
    });
}

function renderTeams() {
    const box = $('#mod-scores-list');
    box.innerHTML = '';
    const scores = lyricsState?.scores || {};
    const names = [...new Set([...sharedTeams.map(t => t.name), ...Object.keys(scores)])];
    if (!names.length) return box.append(el('p', { class: 'hint', text: 'No teams yet.' }));

    names.forEach(name => {
        const score = scores[name] || 0;
        const isClaimed = claimed.includes(name);
        box.append(el('div', { class: 'team', style: 'grid-template-columns: minmax(0,1fr) auto' },
            el('div', { class: 'team-id' },
                el('span', { class: `phone${isClaimed ? ' on' : ''}`, text: '📱', title: 'A phone has joined as this team' }),
                el('strong', { text: name })
            ),
            el('div', { class: 'score-controls' },
                el('button', { class: 'award minus', text: '−', onclick: () => adjust(name, -1) }),
                el('span', { class: `score${score < 0 ? ' negative' : ''}`, style: 'display:inline-block;text-align:center;', text: score }),
                el('button', { class: 'award plus', text: '+', onclick: () => adjust(name, +1) }),
                isClaimed && el('button', {
                    class: 'sm ghost', text: '🔓', title: 'Force this team’s phone to rejoin',
                    onclick: () => { if (confirm(`Force the phone on “${name}” to rejoin?`)) send({ type: 'UNCLAIM_TEAM', team: name }); }
                })
            )
        ));
    });
}

function adjust(team, direction) {
    const amount = parseInt($('#manual-score-input').value, 10) || 1;
    send({ type: 'ADJUST_LYRICS_SCORE', team, amount: amount * direction });
}

const cycle = direction => send({ type: 'CYCLE_LYRICS_SECTION', direction });
$('#btn-prev-snippet').addEventListener('click', () => cycle(-1));
$('#btn-next-snippet').addEventListener('click', () => cycle(1));
$('#btn-reveal-hint').addEventListener('click', () => send({ type: 'REVEAL_LYRICS_HINT' }));
$('#btn-reveal-answer').addEventListener('click', () => send({ type: 'REVEAL_LYRICS_ANSWER' }));
$('#btn-prev-round').addEventListener('click', () => { if (confirm('Go back to the previous round? Submissions for the current round will be cleared.')) send({ type: 'PREV_LYRICS_ROUND' }); });
$('#btn-next-round').addEventListener('click', () => {
    const subs = Object.values(lyricsState?.submissions || {});
    if (subs.some(s => s.status === 'PENDING') && !confirm('Some submissions are still ungraded. Go to the next round anyway?')) return;
    send({ type: 'NEXT_LYRICS_ROUND' });
});
$('#btn-reset-claims').addEventListener('click', () => {
    if (confirm('Send every phone back to the team-selection screen?')) send({ type: 'RESET_CLAIMS' });
});

document.addEventListener('keydown', e => {
    if (isTyping() || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (e.key === 'ArrowLeft') cycle(-1);
    else if (e.key === 'ArrowRight') cycle(1);
    else if (k === 'h') $('#btn-reveal-hint').click();
    else if (k === 'a') $('#btn-reveal-answer').click();
    else if (k === 'n') $('#btn-next-round').click();
});

render();
