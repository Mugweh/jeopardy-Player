'use strict';
/* Game builder. Produces / reads exactly the same game.json structure as
   before:  { gameTitle, finalJeopardy, categories: [{ name, clues: [...] }] }
   The only optional addition is "dailyDoubleId" (set when you tick the
   Daily Double box on a clue); old files without it work unchanged. */

const { $, el, toast, readJsonFile, downloadJson, normalizeGame, clueId, parseClueId } = Common;

const ROWS = 5, COLS = 5;
const DRAFT_KEY = 'builder.draft';
const MEDIA_ICON = { image: '🖼', video: '🎬', audio: '🔊', youtube: '▶️', spotify: '🎵' };

const blankClue = row => ({ type: 'text', url: '', prompt: '', response: '', responseType: 'text', responseUrl: '', points: (row + 1) * 100 });
const blankFinal = () => ({ category: '', type: 'text', url: '', prompt: '', answer: '', responseType: 'text', responseUrl: '' });
const newGame = () => ({
    gameTitle: 'New Jeopardy Game',
    finalJeopardy: blankFinal(),
    categories: Array.from({ length: COLS }, (_, c) => ({
        name: `Category ${c + 1}`,
        clues: Array.from({ length: ROWS }, (_, r) => blankClue(r))
    }))
});

let gameData = newGame();
let activeEdit = null;          // { col, row } while the clue modal is open
let dirty = false;
const undoStack = [];

const isFilled = c => c.prompt.trim() !== '' && c.response.trim() !== '';
const isStarted = c => c.prompt.trim() !== '' || c.response.trim() !== '' || (c.url || '').trim() !== '';

/* ======================================================================
   Change tracking: dirty flag, draft autosave, undo
   ====================================================================== */
let saveTimer;
function touch() {
    dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(gameData)); } catch { /* storage full/blocked */ } }, 400);
    updateStatus();
}

function snapshot() {
    undoStack.push(JSON.stringify({ categories: gameData.categories, dailyDoubleId: gameData.dailyDoubleId }));
    if (undoStack.length > 30) undoStack.shift();
    $('#btn-undo').disabled = false;
}

function undo() {
    const prev = undoStack.pop();
    $('#btn-undo').disabled = undoStack.length === 0;
    if (!prev) return;
    const { categories, dailyDoubleId } = JSON.parse(prev);
    gameData.categories = categories;
    if (dailyDoubleId) gameData.dailyDoubleId = dailyDoubleId; else delete gameData.dailyDoubleId;
    touch(); renderBoard();
    toast('Undone.');
}
$('#btn-undo').addEventListener('click', undo);

window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

/* ======================================================================
   Board
   ====================================================================== */
function renderBoard() {
    const board = $('#builder-board');
    board.innerHTML = '';
    $('#game-title').value = gameData.gameTitle ?? '';

    board.append(el('div', { class: 'cell corner' }));
    gameData.categories.forEach((cat, col) => {
        board.append(el('div', { class: 'cell category-header' },
            el('input', {
                type: 'text', value: cat.name, 'aria-label': `Category ${col + 1} name`, placeholder: `Category ${col + 1}`,
                oninput: e => { gameData.categories[col].name = e.target.value; touch(); }
            })));
    });

    for (let row = 0; row < ROWS; row++) {
        board.append(el('div', { class: 'cell row-label' },
            el('span', { class: 'pts', text: gameData.categories[0].clues[row].points }),
            el('button', {
                class: 'shuffle-btn', text: '🔀',
                title: 'Shuffle the clues in this row across the categories (point values stay in place)',
                'aria-label': `Shuffle row ${row + 1}`,
                onclick: () => shuffleRow(row)
            })));

        for (let col = 0; col < COLS; col++) {
            const clue = gameData.categories[col].clues[row];
            const classes = ['cell', 'clue-cell'];
            if (isFilled(clue)) classes.push('filled'); else if (isStarted(clue)) classes.push('partial');
            if (gameData.dailyDoubleId === clueId(col, row)) classes.push('is-dd');

            const badges = [];
            if (MEDIA_ICON[clue.type]) badges.push(MEDIA_ICON[clue.type]);
            if (MEDIA_ICON[clue.responseType]) badges.push(`↩${MEDIA_ICON[clue.responseType]}`);
            if (gameData.dailyDoubleId === clueId(col, row)) badges.push('⭐ DD');

            board.append(el('div', {
                class: classes.join(' '), role: 'button', tabindex: 0, dataset: { col, row },
                title: isFilled(clue) ? clue.response : 'Click to edit',
                onclick: () => openModal(col, row),
                onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openModal(col, row); } }
            },
                el('span', { class: 'pts', text: clue.points }),
                el('span', { class: 'preview', text: clue.prompt.trim() || (isStarted(clue) ? '(no prompt yet)' : 'Empty') }),
                el('span', { class: 'badges', text: badges.join('  ') })
            ));
        }
    }
    updateStatus();
}

function updateStatus() {
    const clues = gameData.categories.flatMap(c => c.clues.slice(0, ROWS));
    const ready = clues.filter(isFilled).length;
    $('#fill-count').textContent = `${ready} / ${ROWS * COLS} clues ready`;
    const fj = gameData.finalJeopardy || {};
    $('#fj-status').textContent = `Final Jeopardy: ${fj.prompt && fj.answer ? 'ready ✓' : 'not set'}`;
}

/* ======================================================================
   Shuffle a row
   ====================================================================== */
function shuffleRow(row) {
    const clues = gameData.categories.map(cat => cat.clues[row]);
    const contentOf = ({ points, ...content }) => content;
    const signature = c => JSON.stringify(contentOf(c));
    const distinct = new Set(clues.filter(isStarted).map(signature));
    if (distinct.size < 2) return toast('Nothing to shuffle yet — fill in at least two clues in this row.', { type: 'error' });

    // Fisher–Yates; retry so the row visibly changes.
    let perm, tries = 0;
    do {
        perm = clues.map((_, i) => i);
        for (let i = perm.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [perm[i], perm[j]] = [perm[j], perm[i]];
        }
        tries++;
    } while (tries < 20 && perm.every((from, to) => signature(clues[from]) === signature(clues[to])));

    snapshot();
    const points = clues.map(c => c.points);
    const ddCol = parseClueId(gameData.dailyDoubleId)?.row === row ? parseClueId(gameData.dailyDoubleId).col : -1;

    perm.forEach((from, to) => {
        gameData.categories[to].clues[row] = { ...contentOf(clues[from]), points: points[to] };
    });
    // A Daily Double marker travels with its clue.
    if (ddCol >= 0) gameData.dailyDoubleId = clueId(perm.indexOf(ddCol), row);

    touch();
    renderBoard();
    document.querySelectorAll(`.clue-cell[data-row="${row}"]`).forEach(c => c.classList.add('flash'));
    toast(`Shuffled the ${points[0]}-point row.`, { action: 'Undo', onAction: undo });
}

/* ======================================================================
   Clue modal
   ====================================================================== */
const modal = $('#clue-modal');

function bindMediaToggle(selectId, containerId) {
    const select = $(selectId), box = $(containerId);
    const sync = () => box.classList.toggle('hidden', select.value === 'text');
    select.addEventListener('change', sync);
    return sync;
}
const syncClueUrl = bindMediaToggle('#clue-type', '#url-container');
const syncClueRespUrl = bindMediaToggle('#clue-response-type', '#response-url-container');

function openModal(col, row) {
    activeEdit = { col, row };
    const clue = gameData.categories[col].clues[row];
    $('#modal-title').textContent = `${gameData.categories[col].name || `Category ${col + 1}`} — ${clue.points} points`;
    $('#clue-type').value = clue.type || 'text';
    $('#clue-url').value = clue.url || '';
    $('#clue-prompt').value = clue.prompt || '';
    $('#clue-response').value = clue.response || '';
    $('#clue-response-type').value = clue.responseType || 'text';
    $('#clue-response-url').value = clue.responseUrl || '';
    $('#clue-dd').checked = gameData.dailyDoubleId === clueId(col, row);
    syncClueUrl(); syncClueRespUrl();
    modal.classList.remove('hidden');
    $('#clue-prompt').focus();
}

function closeModal() { modal.classList.add('hidden'); activeEdit = null; }

function saveClue() {
    if (!activeEdit) return false;
    const { col, row } = activeEdit;
    const clue = gameData.categories[col].clues[row];
    clue.type = $('#clue-type').value;
    clue.url = clue.type === 'text' ? '' : $('#clue-url').value.trim();
    clue.prompt = $('#clue-prompt').value;
    clue.response = $('#clue-response').value;
    clue.responseType = $('#clue-response-type').value;
    clue.responseUrl = clue.responseType === 'text' ? '' : $('#clue-response-url').value.trim();

    const id = clueId(col, row);
    if ($('#clue-dd').checked) gameData.dailyDoubleId = id;
    else if (gameData.dailyDoubleId === id) delete gameData.dailyDoubleId;

    touch();
    renderBoard();
    return true;
}

$('#btn-cancel').addEventListener('click', closeModal);
$('#btn-save-clue').addEventListener('click', () => { if (saveClue()) closeModal(); });
$('#btn-save-next').addEventListener('click', () => {
    const { col, row } = activeEdit || {};
    if (!saveClue()) return;
    // Walk down the category, then on to the next one.
    let next = row + 1 < ROWS ? { col, row: row + 1 } : (col + 1 < COLS ? { col: col + 1, row: 0 } : null);
    if (next) openModal(next.col, next.row); else { closeModal(); toast('That was the last clue.'); }
});
modal.addEventListener('mousedown', e => { if (e.target === modal) closeModal(); });

/* ======================================================================
   Final Jeopardy modal
   ====================================================================== */
const fjModal = $('#fj-modal');
const syncFjUrl = bindMediaToggle('#build-fj-type', '#build-fj-url-container');
const syncFjRespUrl = bindMediaToggle('#build-fj-response-type', '#build-fj-response-url-container');

$('#btn-edit-fj').addEventListener('click', () => {
    const fj = { ...blankFinal(), ...gameData.finalJeopardy };
    $('#build-fj-category').value = fj.category || '';
    $('#build-fj-type').value = fj.type || 'text';
    $('#build-fj-url').value = fj.url || '';
    $('#build-fj-prompt').value = fj.prompt || '';
    $('#build-fj-answer').value = fj.answer || '';
    $('#build-fj-response-type').value = fj.responseType || 'text';
    $('#build-fj-response-url').value = fj.responseUrl || '';
    syncFjUrl(); syncFjRespUrl();
    fjModal.classList.remove('hidden');
    $('#build-fj-category').focus();
});

const closeFj = () => fjModal.classList.add('hidden');
$('#btn-cancel-fj').addEventListener('click', closeFj);
fjModal.addEventListener('mousedown', e => { if (e.target === fjModal) closeFj(); });

$('#btn-save-fj').addEventListener('click', () => {
    const t = $('#build-fj-type').value, rt = $('#build-fj-response-type').value;
    gameData.finalJeopardy = {
        category: $('#build-fj-category').value,
        type: t,
        url: t === 'text' ? '' : $('#build-fj-url').value.trim(),
        prompt: $('#build-fj-prompt').value,
        answer: $('#build-fj-answer').value,
        responseType: rt,
        responseUrl: rt === 'text' ? '' : $('#build-fj-response-url').value.trim()
    };
    touch(); closeFj();
});

/* ======================================================================
   Toolbar: points, title, new, import, export
   ====================================================================== */
$('#btn-apply-multiplier').addEventListener('click', () => {
    const base = parseInt($('#point-multiplier').value, 10) || 100;
    snapshot();
    gameData.categories.forEach(cat => cat.clues.forEach((clue, i) => { clue.points = (i + 1) * base; }));
    touch(); renderBoard();
    toast(`Row values are now ${base}, ${base * 2} … ${base * 5}.`, { action: 'Undo', onAction: undo });
});

$('#game-title').addEventListener('input', e => { gameData.gameTitle = e.target.value; touch(); });

$('#btn-new').addEventListener('click', () => {
    if (dirty && !confirm('Start a new game? Unsaved changes will be lost (export first if you need them).')) return;
    gameData = newGame(); undoStack.length = 0; $('#btn-undo').disabled = true;
    dirty = false;
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
    renderBoard();
});

$('#btn-import').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
        const parsed = await readJsonFile(file);
        if (!Array.isArray(parsed.categories) || parsed.categories.length !== COLS) {
            throw new Error(`The builder works with exactly ${COLS} categories (this file has ${parsed.categories?.length ?? 0}).`);
        }
        loadGame(parsed);
        toast(`Loaded “${gameData.gameTitle}”.`, { type: 'success' });
    } catch (err) {
        toast(err.message || 'Could not read that file.', { type: 'error' });
    }
});

/** Accepts any older game.json: fills in missing fields, never drops any. */
function loadGame(parsed) {
    normalizeGame(parsed);
    parsed.categories.forEach(cat => { while (cat.clues.length < ROWS) cat.clues.push(blankClue(cat.clues.length)); });
    parsed.finalJeopardy = { ...blankFinal(), ...(parsed.finalJeopardy || {}) };
    if (parsed.gameTitle == null) parsed.gameTitle = 'Imported game';
    const dd = parseClueId(parsed.dailyDoubleId);
    if (!dd || dd.col >= COLS || dd.row >= ROWS) delete parsed.dailyDoubleId;
    gameData = parsed;
    undoStack.length = 0; $('#btn-undo').disabled = true;
    dirty = false;
    renderBoard();
}

$('#btn-export').addEventListener('click', () => {
    gameData.gameTitle = $('#game-title').value;
    if (!gameData.dailyDoubleId) delete gameData.dailyDoubleId;
    const ready = gameData.categories.flatMap(c => c.clues).filter(isFilled).length;
    downloadJson(gameData, 'game.json');
    dirty = false;
    toast(ready < ROWS * COLS ? `Exported game.json (${ROWS * COLS - ready} tiles are still empty).` : 'Exported game.json.', { type: 'success' });
});

/* ======================================================================
   Keyboard
   ====================================================================== */
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        if (!modal.classList.contains('hidden')) closeModal();
        else if (!fjModal.classList.contains('hidden')) closeFj();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && activeEdit) {
        e.preventDefault();
        if (saveClue()) closeModal();
    } else if ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey) && !Common.isTyping()
               && modal.classList.contains('hidden') && fjModal.classList.contains('hidden')) {
        e.preventDefault(); undo();
    }
});

/* ======================================================================
   Start: restore an unsaved draft if there is one
   ====================================================================== */
(function init() {
    try {
        const raw = localStorage.getItem(DRAFT_KEY);
        if (raw) {
            const draft = JSON.parse(raw);
            if (Array.isArray(draft.categories) && draft.categories.length === COLS) {
                loadGame(draft);
                dirty = true;
                toast('Restored your unsaved draft.', {
                    action: 'Start fresh',
                    onAction: () => { gameData = newGame(); dirty = false; try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } renderBoard(); }
                });
                return;
            }
        }
    } catch { /* corrupt draft: ignore */ }
    renderBoard();
})();
