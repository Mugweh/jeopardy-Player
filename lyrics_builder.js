let packData = {
    title: "Anime Lyrics Showdown",
    rounds: []
};

function renderRounds() {
    const container = document.getElementById('rounds-container');
    container.innerHTML = '';

    packData.rounds.forEach((round, rIndex) => {
        const div = document.createElement('div');
        div.className = 'panel-section';
        div.style.background = '#1e1e1e';
        div.style.padding = '20px';
        div.style.borderRadius = '8px';
        div.style.border = '1px solid #333';
        div.style.display = 'flex';
        div.style.flexDirection = 'column';
        div.style.gap = '12px';

        let lyricsSectionsHtml = '';
        round.lyrics.forEach((snippet, sIndex) => {
            lyricsSectionsHtml += `
                <div style="display: flex; gap: 10px; align-items: flex-start; margin-top: 5px;">
                    <span style="color: var(--neon-yellow); font-weight: bold; margin-top: 10px;">#${sIndex + 1}</span>
                    <textarea rows="2" placeholder="Lyric excerpt/section ${sIndex + 1}..." 
                        style="flex: 1; background:#121212; color:white; border:1px solid #333; padding:10px; border-radius:6px;" 
                        oninput="packData.rounds[${rIndex}].lyrics[${sIndex}] = this.value">${snippet || ''}</textarea>
                    ${round.lyrics.length > 1 ? `<button onclick="removeSnippet(${rIndex},${sIndex})" style="background:#ef4444; padding:8px 12px; margin-top:5px; border-radius:6px;">✖</button>` : ''}
                </div>
            `;
        });

        div.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <h3 style="color: var(--neon-yellow); margin: 0;">Round ${rIndex + 1}</h3>
                <button class="btn-secondary" onclick="removeRound(${rIndex})" style="background: #ef4444;">Remove Round</button>
            </div>
            
            <label style="color:#ccc; font-weight:bold;">Lyric Sections / Snippets (Cyclable in Moderator):</label>
            ${lyricsSectionsHtml}
            <button onclick="addSnippet(${rIndex})" style="background: var(--accent-blue); padding: 6px 12px; align-self: flex-start; margin-top: 5px; border-radius: 6px;">+ Add Snippet Section</button>

            <label style="color:#ccc; font-weight:bold; margin-top: 10px;">Correct Anime Answer:</label>
            <input type="text" placeholder="e.g., Azumanga Daioh" value="${round.answer || ''}" 
                style="width:100%; background:#121212; color:white; border:1px solid #333; padding:10px; border-radius:6px;" 
                oninput="packData.rounds[${rIndex}].answer = this.value">
        `;
        container.appendChild(div);
    });
}

function addRound() {
    packData.rounds.push({ lyrics: [''], answer: '' });
    renderRounds();
}

function removeRound(rIndex) {
    packData.rounds.splice(rIndex, 1);
    renderRounds();
}

function addSnippet(rIndex) {
    packData.rounds[rIndex].lyrics.push('');
    renderRounds();
}

function removeSnippet(rIndex, sIndex) {
    packData.rounds[rIndex].lyrics.splice(sIndex, 1);
    renderRounds();
}

document.getElementById('btn-add-round').addEventListener('click', addRound);

document.getElementById('btn-export').addEventListener('click', () => {
    packData.title = document.getElementById('game-title').value;
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(packData, null, 2));
    const dl = document.createElement('a');
    dl.setAttribute("href", dataStr);
    dl.setAttribute("download", "lyrics_game.json");
    document.body.appendChild(dl);
    dl.click();
    dl.remove();
});

document.getElementById('import-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
        try {
            const loaded = JSON.parse(evt.target.result);
            if (loaded.rounds) {
                // Backward compatibility normalization if lyrics was a single string
                loaded.rounds.forEach(r => {
                    if (typeof r.lyrics === 'string') {
                        r.lyrics = [r.lyrics];
                    }
                });
                packData = loaded;
                document.getElementById('game-title').value = packData.title || "Anime Lyrics Showdown";
                renderRounds();
            }
        } catch (err) { alert("Invalid JSON format."); }
    };
    reader.readAsText(file);
});

// Initialize with one blank round
addRound();