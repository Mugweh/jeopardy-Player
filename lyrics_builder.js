'use strict';
/* Lyrics pack builder. File format is unchanged:
   { title, rounds: [{ lyrics: ["snippet", ...], answer: "..." }] }
   Older packs where `lyrics` is a single string still load. */

const { $, el, toast, readJsonFile, downloadJson } = Common;

let packData = { title: 'Anime Lyrics Showdown', rounds: [] };
let dirty = false;
const touch = () => { dirty = true; };
window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

function renderRounds() {
    const box = $('#rounds-container');
    box.innerHTML = '';
    $('#game-title').value = packData.title ?? '';
    $('#round-count').textContent = `${packData.rounds.length} round${packData.rounds.length === 1 ? '' : 's'}`;

    packData.rounds.forEach((round, r) => {
        const snippets = round.lyrics.map((text, s) => el('div', { class: 'snippet-row' },
            el('span', { class: 'num', text: `#${s + 1}` }),
            el('textarea', {
                rows: 3, placeholder: `Lyric excerpt ${s + 1}…`, 'aria-label': `Snippet ${s + 1}`,
                oninput: e => { round.lyrics[s] = e.target.value; touch(); }
            }, text || ''),
            round.lyrics.length > 1 && el('button', {
                class: 'danger sm', text: '✖', title: 'Remove snippet',
                onclick: () => { round.lyrics.splice(s, 1); touch(); renderRounds(); }
            })
        ));

        box.append(el('div', { class: 'card round-card' },
            el('div', { class: 'card-head', style: 'margin:0' },
                el('h3', { style: 'color:var(--gold)', text: `Round ${r + 1}` }),
                el('div', { class: 'round-actions' },
                    el('button', { class: 'ghost sm', text: '↑', title: 'Move up', disabled: r === 0, onclick: () => move(r, -1) }),
                    el('button', { class: 'ghost sm', text: '↓', title: 'Move down', disabled: r === packData.rounds.length - 1, onclick: () => move(r, 1) }),
                    el('button', { class: 'danger sm', text: 'Remove round', onclick: () => { if (confirm(`Remove round ${r + 1}?`)) { packData.rounds.splice(r, 1); touch(); renderRounds(); } } })
                )
            ),
            el('label', { class: 'field', text: 'Lyric snippets (the moderator can step through these)' }),
            ...snippets,
            el('button', { class: 'ghost sm', style: 'align-self:flex-start', text: '＋ Add snippet', onclick: () => { round.lyrics.push(''); touch(); renderRounds(); } }),
            el('label', { class: 'field', style: 'margin-top:.4rem', text: 'Correct answer' }),
            el('input', {
                type: 'text', value: round.answer || '', placeholder: 'e.g. Azumanga Daioh',
                oninput: e => { round.answer = e.target.value; touch(); }
            })
        ));
    });
}

function move(index, delta) {
    const [round] = packData.rounds.splice(index, 1);
    packData.rounds.splice(index + delta, 0, round);
    touch(); renderRounds();
}

$('#btn-add-round').addEventListener('click', () => {
    packData.rounds.push({ lyrics: [''], answer: '' });
    touch(); renderRounds();
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
});

$('#game-title').addEventListener('input', e => { packData.title = e.target.value; touch(); });

$('#btn-export').addEventListener('click', () => {
    packData.title = $('#game-title').value;
    downloadJson(packData, 'lyrics_game.json');
    dirty = false;
    toast('Exported lyrics_game.json.', { type: 'success' });
});

$('#btn-import').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
        const loaded = await readJsonFile(file);
        if (!Array.isArray(loaded.rounds)) throw new Error('This file has no "rounds" list, so it isn’t a lyrics pack.');
        loaded.rounds.forEach(r => {
            if (typeof r.lyrics === 'string') r.lyrics = [r.lyrics];
            if (!Array.isArray(r.lyrics) || !r.lyrics.length) r.lyrics = [''];
            r.answer = r.answer ?? '';
        });
        packData = loaded;
        if (packData.title == null) packData.title = 'Anime Lyrics Showdown';
        dirty = false;
        renderRounds();
        toast('Pack loaded.', { type: 'success' });
    } catch (err) {
        toast(err.message, { type: 'error' });
    }
});

packData.rounds.push({ lyrics: [''], answer: '' });
renderRounds();
