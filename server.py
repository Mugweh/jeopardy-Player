from flask import Flask, send_from_directory
from flask_socketio import SocketIO, emit
import os
import json

app = Flask(__name__, static_folder='.')
app.config['SECRET_KEY'] = 'jeopardy_secret!'
socketio = SocketIO(app, cors_allowed_origins="*")

SAVE_FILE = 'game_save.json'

# --- Centralized Server State ---
server_state = {
    'gameData': None,
    'teams': [
        {'name': 'Team 1', 'score': 0},
        {'name': 'Team 2', 'score': 0},
        {'name': 'Team 3', 'score': 0}
    ],
    'answeredClues': [],
    'buzzerOrder': [],
    'activeOverlay': None,
    'claimedTeams': [],
    'teamWagers': {},
    # --- Dedicated Lyrics Game State ---
    'lyricsState': {
        'gameData': None,
        'currentRound': 0,
        'currentLyricSection': 0,
        'hintsRevealed': 0,
        'answerRevealed': False,
        'submissions': {},
        'scores': {}
    }
}

def load_state():
    global server_state
    if os.path.exists(SAVE_FILE):
        try:
            with open(SAVE_FILE, 'r') as f:
                saved = json.load(f)
                for key in server_state:
                    if key not in saved:
                        saved[key] = server_state[key]
                server_state = saved
                print("Game state loaded from disk.")
        except Exception as e:
            print("Error loading state from disk:", e)

def save_state():
    try:
        with open(SAVE_FILE, 'w') as f:
            json.dump(server_state, f)
    except Exception as e:
        print("Error saving state to disk:", e)

load_state()

@app.route('/')
def index():
    return send_from_directory('.', 'player.html')

@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory('.', path)

@socketio.on('connect')
def handle_connect():
    emit('game_event', {'type': 'SYNC_FULL_STATE', 'state': server_state})
    emit('game_event', {'type': 'SYNC_LYRICS_STATE', 'state': server_state['lyricsState']})

@socketio.on('game_event')
def handle_game_event(data):
    global server_state
    msg_type = data.get('type')
    state_changed = False

    if msg_type == 'FORCE_SYNC':
        emit('game_event', {'type': 'SYNC_FULL_STATE', 'state': server_state}, broadcast=True, include_self=False)
        emit('game_event', {'type': 'SYNC_LYRICS_STATE', 'state': server_state['lyricsState']}, broadcast=True, include_self=False)
        return

    elif msg_type == 'LOAD_GAME':
        server_state['gameData'] = data.get('data')
        server_state['answeredClues'] = []
        server_state['buzzerOrder'] = []
        server_state['activeOverlay'] = None
        state_changed = True

    elif msg_type == 'UPDATE_SCORES':
        server_state['teams'] = data.get('teams', server_state['teams'])
        state_changed = True

    elif msg_type == 'CLAIM_TEAM':
        team = data.get('team')
        if team and team not in server_state['claimedTeams']:
            server_state['claimedTeams'].append(team)
        state_changed = True
        data = {'type': 'UPDATE_CLAIMS', 'claimedTeams': server_state['claimedTeams']}

    elif msg_type == 'RESET_CLAIMS':
        server_state['claimedTeams'] = []
        state_changed = True
        data = {'type': 'UPDATE_CLAIMS', 'claimedTeams': []}

    elif msg_type == 'UNCLAIM_TEAM':
        team = data.get('team')
        if team and team in server_state['claimedTeams']:
            server_state['claimedTeams'].remove(team)
        state_changed = True
        data = {'type': 'UPDATE_CLAIMS', 'claimedTeams': server_state['claimedTeams']}

    # --- Dedicated Lyrics Game Socket Handlers ---
    elif msg_type == 'LOAD_LYRICS_GAME':
        lState = server_state['lyricsState']
        lState['gameData'] = data.get('data')
        lState['currentRound'] = 0
        lState['currentLyricSection'] = 0
        lState['hintsRevealed'] = 0
        lState['answerRevealed'] = False
        lState['submissions'] = {}
        state_changed = True
        emit('game_event', {'type': 'UPDATE_LYRICS_STATE', 'state': lState}, broadcast=True)
        save_state()
        return

    elif msg_type == 'CYCLE_LYRICS_SECTION':
        direction = data.get('direction', 1)
        lState = server_state['lyricsState']
        if lState['gameData'] and 'rounds' in lState['gameData']:
            rIdx = lState['currentRound']
            if rIdx < len(lState['gameData']['rounds']):
                lyrics_arr = lState['gameData']['rounds'][rIdx].get('lyrics', [])
                if lyrics_arr:
                    new_idx = lState.get('currentLyricSection', 0) + direction
                    lState['currentLyricSection'] = max(0, min(len(lyrics_arr) - 1, new_idx))
                    state_changed = True
                    emit('game_event', {'type': 'UPDATE_LYRICS_STATE', 'state': lState}, broadcast=True)

    elif msg_type == 'REVEAL_LYRICS_HINT':
        lState = server_state['lyricsState']
        if lState['hintsRevealed'] < 3:
            lState['hintsRevealed'] += 1
            state_changed = True
            emit('game_event', {'type': 'UPDATE_LYRICS_STATE', 'state': lState}, broadcast=True)

    elif msg_type == 'SUBMIT_LYRICS_ANSWER':
        team = data.get('team')
        answer = data.get('answer')
        lState = server_state['lyricsState']
        if team and team not in lState['submissions']:
            lState['submissions'][team] = {
                'answer': answer,
                'stage': lState['hintsRevealed'],
                'status': 'PENDING'
            }
            state_changed = True
            emit('game_event', {'type': 'UPDATE_LYRICS_STATE', 'state': lState}, broadcast=True)

    elif msg_type == 'GRADE_LYRICS_SUBMISSION':
        team = data.get('team')
        is_correct = data.get('isCorrect')
        lState = server_state['lyricsState']
        if team in lState['submissions']:
            stage = lState['submissions'][team]['stage']
            points_value = 4 - stage
            lState['submissions'][team]['status'] = 'CORRECT' if is_correct else 'INCORRECT'
            
            if is_correct:
                lState['scores'][team] = lState['scores'].get(team, 0) + points_value
            else:
                lState['scores'][team] = lState['scores'].get(team, 0) - points_value
            
            state_changed = True
            emit('game_event', {'type': 'UPDATE_LYRICS_STATE', 'state': lState}, broadcast=True)

    elif msg_type == 'ADJUST_LYRICS_SCORE':
        team = data.get('team')
        amount = int(data.get('amount', 0))
        lState = server_state['lyricsState']
        if team:
            lState['scores'][team] = lState['scores'].get(team, 0) + amount
            state_changed = True
            emit('game_event', {'type': 'UPDATE_LYRICS_STATE', 'state': lState}, broadcast=True)

    elif msg_type == 'REVEAL_LYRICS_ANSWER':
        lState = server_state['lyricsState']
        lState['answerRevealed'] = True
        state_changed = True
        emit('game_event', {'type': 'UPDATE_LYRICS_STATE', 'state': lState}, broadcast=True)

    elif msg_type == 'NEXT_LYRICS_ROUND':
        lState = server_state['lyricsState']
        lState['currentRound'] += 1
        lState['currentLyricSection'] = 0
        lState['hintsRevealed'] = 0
        lState['answerRevealed'] = False
        lState['submissions'] = {}
        state_changed = True
        emit('game_event', {'type': 'UPDATE_LYRICS_STATE', 'state': lState}, broadcast=True)

    if state_changed:
        save_state()

    emit('game_event', data, broadcast=True, include_self=False)

if __name__ == '__main__':
    print("=========================================")
    print("Trivia Server Running!")
    print("Host locally at: http://localhost:5000")
    print("=========================================")
    socketio.run(app, host='0.0.0.0', port=5000)