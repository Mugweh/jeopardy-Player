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

// --- NEW TEAM SELECT & WAGER LOGIC ---
let myTeam = "";
let isEnabled = false;
let hasBuzzed = false;
let currentTeams = [];
let claimedTeams = [];

function renderTeamSelect() {
    const select = document.getElementById('team-select');
    const btnJoin = document.getElementById('btn-join');
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

document.getElementById('btn-join').addEventListener('click', () => {
    const select = document.getElementById('team-select');
    myTeam = select.value;
    if (!myTeam) return;
    
    gameChannel.postMessage({ type: 'CLAIM_TEAM', team: myTeam });
    
    document.getElementById('setup-screen').classList.add('hidden');
    document.getElementById('buzzer-screen').classList.remove('hidden');
});

document.getElementById('btn-submit-wager').addEventListener('click', () => {
    const wager = parseInt(document.getElementById('wager-input').value, 10) || 0;
    gameChannel.postMessage({ type: 'SUBMIT_WAGER', team: myTeam, wager: wager });
    
    document.getElementById('wager-screen').classList.add('hidden');
    document.getElementById('buzzer-screen').classList.remove('hidden');
});

document.getElementById('buzzer-screen').addEventListener('mousedown', buzzIn);
document.getElementById('buzzer-screen').addEventListener('touchstart', buzzIn);

function buzzIn(e) {
    e.preventDefault(); 
    if (isEnabled && !hasBuzzed) {
        isEnabled = false; 
        hasBuzzed = true;  
        gameChannel.postMessage({ type: 'BUZZ_IN', team: myTeam });
    }
}

gameChannel.onmessage = (event) => {
    const msg = event.data;
    const bScreen = document.getElementById('buzzer-screen');
    const status = document.getElementById('buzzer-status');

    if (msg.type === 'SYNC_FULL_STATE') {
        currentTeams = msg.state.teams || [];
        claimedTeams = msg.state.claimedTeams || [];
        renderTeamSelect();
    } 
    else if (msg.type === 'UPDATE_SCORES') {
        currentTeams = msg.teams || [];
        renderTeamSelect();
    } 
    else if (msg.type === 'UPDATE_CLAIMS') {
        claimedTeams = msg.claimedTeams || [];
        renderTeamSelect();
        
        // Kick back to setup if host resets claims
        if (claimedTeams.length === 0 && myTeam !== "") {
            myTeam = "";
            document.getElementById('setup-screen').classList.remove('hidden');
            document.getElementById('buzzer-screen').classList.add('hidden');
            document.getElementById('wager-screen').classList.add('hidden');
            isEnabled = false;
        }
    } 
    else if (msg.type === 'REQUEST_WAGER') {
        if (msg.team === myTeam) {
            document.getElementById('buzzer-screen').classList.add('hidden');
            document.getElementById('wager-screen').classList.remove('hidden');
            document.getElementById('wager-input').value = ''; // Clear previous
        }
    }
    else if (msg.type === 'ENABLE_BUZZERS') {
        isEnabled = true;
        hasBuzzed = false; 
        bScreen.className = 'active';
        status.textContent = "BUZZ IN!";
    } 
    else if (msg.type === 'DISABLE_BUZZERS' || msg.type === 'CLOSE_CLUE' || msg.type === 'RESET_GAME') {
        isEnabled = false;
        hasBuzzed = false; 
        bScreen.className = 'waiting';
        status.textContent = "WAITING...";
        
        if (myTeam !== "") {
            document.getElementById('wager-screen').classList.add('hidden');
            document.getElementById('buzzer-screen').classList.remove('hidden');
        }
    } 
    else if (msg.type === 'BUZZER_ORDER') {
        const myRank = msg.order.indexOf(myTeam);
        
        if (myRank === 0) {
            bScreen.className = 'first';
            status.textContent = "YOU BUZZED FIRST!";
        } else if (myRank > 0) {
            bScreen.className = 'late';
            status.innerHTML = `LATE<br><span style="font-size: 4vw;">(Rank: ${myRank + 1})</span>`;
        } else {
            if (hasBuzzed) {
                isEnabled = false;
                bScreen.className = 'locked';
                status.textContent = "LOCKED OUT";
            }
        }
    }
};