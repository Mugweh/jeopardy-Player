// The core JSON structure that maps to your game engine
let gameData = {
    gameTitle: "New Jeopardy Game",
    categories: []
};

let activeEdit = { col: null, row: null }; // Tracks which cell is open in the modal

// Initialize an empty 5x5 board
function initializeEmptyBoard() {
    gameData.categories = Array.from({ length: 5 }, (_, colIndex) => ({
        name: `Category ${colIndex + 1}`,
        clues: Array.from({ length: 5 }, (_, rowIndex) => ({
            type: "text",
            prompt: "",
            response: "",
            url: "",
            points: (rowIndex + 1) * 100
        }))
    }));
}

// Render the grid to the screen
function renderBoard() {
    const board = document.getElementById('builder-board');
    board.innerHTML = '';
    document.getElementById('game-title').value = gameData.gameTitle;

    // 1. Render Category Headers
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

    // 2. Render Clue Squares
    for (let row = 0; row < 5; row++) {
        for (let col = 0; col < 5; col++) {
            const clue = gameData.categories[col].clues[row];
            const clueDiv = document.createElement('div');
            clueDiv.className = 'cell clue-cell';
            
            // Visual check: If it has a prompt AND response, mark it as filled
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

typeSelect.addEventListener('change', (e) => {
    urlContainer.className = (e.target.value === 'text') ? 'hidden' : '';
});

function openModal(col, row) {
    activeEdit = { col, row };
    const clue = gameData.categories[col].clues[row];

    document.getElementById('modal-title').textContent = `Edit Clue - ${clue.points} Points`;
    document.getElementById('clue-type').value = clue.type || 'text';
    document.getElementById('clue-url').value = clue.url || '';
    document.getElementById('clue-prompt').value = clue.prompt || '';
    document.getElementById('clue-response').value = clue.response || '';

    // Trigger URL box visibility
    urlContainer.className = (clue.type === 'text' || !clue.type) ? 'hidden' : '';
    
    modal.classList.remove('hidden');
}

document.getElementById('btn-cancel').addEventListener('click', () => {
    modal.classList.add('hidden');
    activeEdit = { col: null, row: null };
});

document.getElementById('btn-save-clue').addEventListener('click', () => {
    const { col, row } = activeEdit;
    if (col === null || row === null) return;

    // Update internal gameData
    const clue = gameData.categories[col].clues[row];
    clue.type = document.getElementById('clue-type').value;
    clue.url = document.getElementById('clue-url').value;
    clue.prompt = document.getElementById('clue-prompt').value;
    clue.response = document.getElementById('clue-response').value;

    // Hide text-only url values to keep JSON clean
    if (clue.type === 'text') clue.url = "";

    modal.classList.add('hidden');
    renderBoard(); // Re-render to update the visual "filled" state
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

// Start the app
initializeEmptyBoard();
renderBoard();