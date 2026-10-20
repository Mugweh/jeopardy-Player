// The core JSON structure that maps to your game engine
let gameData = {
    gameTitle: "New Jeopardy Game",
    finalJeopardy: { category: "", type: "text", url: "", prompt: "", answer: "", responseType: "text", responseUrl: "" },
    categories: []
};

let activeEdit = { col: null, row: null };

// Initialize an empty 5x5 board
function initializeEmptyBoard() {
    gameData.categories = Array.from({ length: 5 }, (_, colIndex) => ({
        name: `Category ${colIndex + 1}`,
        clues: Array.from({ length: 5 }, (_, rowIndex) => ({
            type: "text",
            url: "",
            prompt: "",
            response: "",
            responseType: "text",
            responseUrl: "",
            points: (rowIndex + 1) * 100
        }))
    }));
}

// Render the grid to the screen
function renderBoard() {
    const board = document.getElementById('builder-board');
    board.innerHTML = '';
    document.getElementById('game-title').value = gameData.gameTitle;

    gameData.categories.forEach((cat, col) => {
        const headerDiv = document.createElement('div');
        headerDiv.className = 'cell category-header';
        
        const input = document.createElement('input');
        input.type = 'text';
        input.value = cat.name;
        input.addEventListener('input', (e) => {
            gameData.categories[col].name = e.target.value;
        });

        headerDiv.appendChild(input);
        board.appendChild(headerDiv);
    });

    for (let row = 0; row < 5; row++) {
        for (let col = 0; col < 5; col++) {
            const clue = gameData.categories[col].clues[row];
            const clueDiv = document.createElement('div');
            clueDiv.className = 'cell clue-cell';
            
            if (clue.prompt.trim() !== "" && clue.response.trim() !== "") {
                clueDiv.classList.add('filled');
            }

            clueDiv.textContent = clue.points;
            clueDiv.addEventListener('click', () => openModal(col, row));
            board.appendChild(clueDiv);
        }
    }
}

// --- MODAL LOGIC ---
const modal = document.getElementById('clue-modal');
const typeSelect = document.getElementById('clue-type');
const urlContainer = document.getElementById('url-container');

const respTypeSelect = document.getElementById('clue-response-type');
const respUrlContainer = document.getElementById('response-url-container');

typeSelect.addEventListener('change', (e) => {
    urlContainer.className = (e.target.value === 'text') ? 'hidden' : '';
});

respTypeSelect.addEventListener('change', (e) => {
    respUrlContainer.className = (e.target.value === 'text') ? 'hidden' : '';
});

function openModal(col, row) {
    activeEdit = { col, row };
    const clue = gameData.categories[col].clues[row];

    document.getElementById('modal-title').textContent = `Edit Clue - ${clue.points} Points`;
    document.getElementById('clue-type').value = clue.type || 'text';
    document.getElementById('clue-url').value = clue.url || '';
    document.getElementById('clue-prompt').value = clue.prompt || '';
    document.getElementById('clue-response').value = clue.response || '';
    
    document.getElementById('clue-response-type').value = clue.responseType || 'text';
    document.getElementById('clue-response-url').value = clue.responseUrl || '';

    urlContainer.className = (clue.type === 'text' || !clue.type) ? 'hidden' : '';
    respUrlContainer.className = (clue.responseType === 'text' || !clue.responseType) ? 'hidden' : '';
    
    modal.classList.remove('hidden');
}

document.getElementById('btn-cancel').addEventListener('click', () => {
    modal.classList.add('hidden');
    activeEdit = { col: null, row: null };
});

document.getElementById('btn-save-clue').addEventListener('click', () => {
    const { col, row } = activeEdit;
    if (col === null || row === null) return;

    const clue = gameData.categories[col].clues[row];
    clue.type = document.getElementById('clue-type').value;
    clue.url = document.getElementById('clue-url').value;
    clue.prompt = document.getElementById('clue-prompt').value;
    clue.response = document.getElementById('clue-response').value;
    
    clue.responseType = document.getElementById('clue-response-type').value;
    clue.responseUrl = document.getElementById('clue-response-url').value;

    if (clue.type === 'text') clue.url = "";
    if (clue.responseType === 'text') clue.responseUrl = "";

    modal.classList.add('hidden');
    renderBoard(); 
});

// --- IMPORT & EXPORT LOGIC ---
document.getElementById('btn-export').addEventListener('click', () => {
    gameData.gameTitle = document.getElementById('game-title').value;
    
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(gameData, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", "game.json");
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
});

document.getElementById('import-file').addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const parsedData = JSON.parse(e.target.result);
            if (parsedData.categories && parsedData.categories.length === 5) {
                gameData = parsedData;
                if (!gameData.finalJeopardy) {
                    gameData.finalJeopardy = { category: "", type: "text", url: "", prompt: "", answer: "", responseType: "text", responseUrl: "" };
                }
                renderBoard();
            } else {
                alert("Invalid format! Must have exactly 5 categories.");
            }
        } catch (err) {
            alert("Error parsing JSON file. Is it corrupted?");
        }
    };
    reader.readAsText(file);
});

document.getElementById('btn-apply-multiplier').addEventListener('click', () => {
    const baseVal = parseInt(document.getElementById('point-multiplier').value, 10) || 100;
    gameData.categories.forEach(cat => {
        cat.clues.forEach((clue, index) => {
            clue.points = (index + 1) * baseVal;
        });
    });
    renderBoard();
});

// --- NEW LOGIC: Final Jeopardy Modal ---
const fjModal = document.getElementById('fj-modal');
const buildFjTypeSelect = document.getElementById('build-fj-type');
const buildFjUrlContainer = document.getElementById('build-fj-url-container');

const buildFjRespTypeSelect = document.getElementById('build-fj-response-type');
const buildFjRespUrlContainer = document.getElementById('build-fj-response-url-container');

buildFjTypeSelect.addEventListener('change', (e) => {
    buildFjUrlContainer.className = (e.target.value === 'text') ? 'hidden' : '';
});

buildFjRespTypeSelect.addEventListener('change', (e) => {
    buildFjRespUrlContainer.className = (e.target.value === 'text') ? 'hidden' : '';
});

document.getElementById('btn-edit-fj').addEventListener('click', () => {
    const fj = gameData.finalJeopardy;
    document.getElementById('build-fj-category').value = fj.category || '';
    document.getElementById('build-fj-type').value = fj.type || 'text';
    document.getElementById('build-fj-url').value = fj.url || '';
    document.getElementById('build-fj-prompt').value = fj.prompt || '';
    document.getElementById('build-fj-answer').value = fj.answer || '';
    
    document.getElementById('build-fj-response-type').value = fj.responseType || 'text';
    document.getElementById('build-fj-response-url').value = fj.responseUrl || '';
    
    buildFjUrlContainer.className = (fj.type === 'text' || !fj.type) ? 'hidden' : '';
    buildFjRespUrlContainer.className = (fj.responseType === 'text' || !fj.responseType) ? 'hidden' : '';
    
    fjModal.classList.remove('hidden');
});

document.getElementById('btn-cancel-fj').addEventListener('click', () => {
    fjModal.classList.add('hidden');
});

document.getElementById('btn-save-fj').addEventListener('click', () => {
    const t = document.getElementById('build-fj-type').value;
    const rt = document.getElementById('build-fj-response-type').value;
    
    gameData.finalJeopardy = {
        category: document.getElementById('build-fj-category').value,
        type: t,
        url: t === 'text' ? "" : document.getElementById('build-fj-url').value,
        prompt: document.getElementById('build-fj-prompt').value,
        answer: document.getElementById('build-fj-answer').value,
        responseType: rt,
        responseUrl: rt === 'text' ? "" : document.getElementById('build-fj-response-url').value
    };
    fjModal.classList.add('hidden');
});

// Start the app
initializeEmptyBoard();
renderBoard();