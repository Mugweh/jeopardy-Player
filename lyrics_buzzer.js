const socket = io();
let myTeam = "";
let currentTeams = [];
let claimedTeams = [];
let lyricsState = null;

function renderTeamSelect() {
    const select = document.getElementById('team-select');
    const btnJoin = document.getElementById('btn-join-lyrics');
    select.innerHTML = '';
    
    const available = currentTeams.filter(t => !claimedTeams.includes(t.name));
    
    if (available.length === 0) {
        select.innerHTML = '<option value="">No teams available</option>';
        btnJoin.disabled = true;
        btnJoin.style.opacity = 0.5;
    } else {
        btnJoin.disabled = false;
        btnJoin.style.opacity = 1;
        available.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.name;
            opt.textContent = t.name;
            select.appendChild(opt);
        });
    }
}

document.getElementById('btn-join-lyrics').addEventListener('click', () => {
    const select = document.getElementById('team-select');
    myTeam = select.value;
    if (!myTeam) return;
    
    socket.emit('game_event', { type: 'CLAIM_TEAM', team: myTeam });
    
    document.getElementById('setup-screen').classList.add('hidden');
    document.getElementById('answer-screen').classList.remove('hidden');
});

document.getElementById('btn-submit-answer').addEventListener('click', () => {
    const ans = document.getElementById('player-answer-input').value.trim();
    if (!ans || !myTeam) return;

    socket.emit('game_event', {
        type: 'SUBMIT_LYRICS_ANSWER',
        team: myTeam,
        answer: ans
    });
});

socket.on('game_event', (data) => {
    const msg = data;

    if (msg.type === 'SYNC_FULL_STATE') {
        currentTeams = msg.state.teams || [];
        claimedTeams = msg.state.claimedTeams || [];
        lyricsState = msg.state.lyricsState || null;
        renderTeamSelect();
        updateBuzzerState();
    }
    else if (msg.type === 'UPDATE_SCORES') {
        currentTeams = msg.teams || [];
        renderTeamSelect();
    }
    else if (msg.type === 'UPDATE_CLAIMS') {
        claimedTeams = msg.claimedTeams || [];
        renderTeamSelect();
        
        // Kick back to setup if host unclaims this team
        if (myTeam !== "" && !claimedTeams.includes(myTeam)) {
            myTeam = "";
            document.getElementById('setup-screen').classList.remove('hidden');
            document.getElementById('answer-screen').classList.add('hidden');
        }
    }
    else if (msg.type === 'UPDATE_LYRICS_STATE' || msg.type === 'SYNC_LYRICS_STATE') {
        lyricsState = msg.state;
        updateBuzzerState();
    }
});

function updateBuzzerState() {
    if (!lyricsState || !myTeam) return;

    const subs = lyricsState.submissions || {};
    const hasSubmitted = subs[myTeam] !== undefined;

    const submitBtn = document.getElementById('btn-submit-answer');
    const txtInput = document.getElementById('player-answer-input');
    const notice = document.getElementById('lockout-notice');
    const title = document.getElementById('lyrics-status-title');

    if (hasSubmitted) {
        submitBtn.disabled = true;
        submitBtn.style.opacity = 0.5;
        txtInput.disabled = true;
        notice.style.display = 'block';
        notice.textContent = `LOCKED IN AT ${4 - subs[myTeam].stage} PTS VALUE!`;
        title.textContent = "ANSWER SUBMITTED";
    } else {
        submitBtn.disabled = false;
        submitBtn.style.opacity = 1;
        txtInput.disabled = false;
        txtInput.value = '';
        notice.style.display = 'none';
        title.textContent = `ROUND VALUE: ${4 - lyricsState.hintsRevealed} PTS`;
    }
}