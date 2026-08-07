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
    'activeOverlay': None
}

def load_state():
    global server_state
    if os.path.exists(SAVE_FILE):
        try:
            with open(SAVE_FILE, 'r') as f:
                server_state = json.load(f)
                print("Game state loaded from disk.")
        except Exception as e:
            print("Error loading state from disk:", e)

def save_state():
    try:
        with open(SAVE_FILE, 'w') as f:
            json.dump(server_state, f)
    except Exception as e:
        print("Error saving state to disk:", e)

# Load existing state when the server boots
load_state()

@app.route('/')
def index():
    return send_from_directory('.', 'player.html')

@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory('.', path)

@socketio.on('connect')
def handle_connect():
    # Send the remembered state to anyone who connects/refreshes instantly
    emit('game_event', {'type': 'SYNC_FULL_STATE', 'state': server_state})

@socketio.on('game_event')
def handle_game_event(data):
    global server_state
    msg_type = data.get('type')
    state_changed = False

    # Force a sync broadcast to all players manually
    if msg_type == 'FORCE_SYNC':
        emit('game_event', {'type': 'SYNC_FULL_STATE', 'state': server_state}, broadcast=True, include_self=False)
        return

    # Intercept and update server memory before broadcasting
    if msg_type == 'LOAD_GAME':
        server_state['gameData'] = data.get('data')
        server_state['answeredClues'] = []
        server_state['buzzerOrder'] = []
        server_state['activeOverlay'] = None
        state_changed = True
    elif msg_type == 'UPDATE_SCORES':
        server_state['teams'] = data.get('teams', server_state['teams'])
        state_changed = True
    elif msg_type in ['SHOW_PROMPT', 'SHOW_DAILY_DOUBLE', 'SHOW_FJ_CATEGORY', 'SHOW_FJ_PROMPT']:
        server_state['activeOverlay'] = data
        clue_id = data.get('clueId')
        if clue_id and clue_id not in server_state['answeredClues']:
            server_state['answeredClues'].append(clue_id)
        state_changed = True
    elif msg_type == 'SHOW_ANSWER' or msg_type == 'SHOW_FJ_ANSWER':
        server_state['activeOverlay'] = data
        state_changed = True
    elif msg_type == 'CLOSE_CLUE':
        server_state['activeOverlay'] = None
        server_state['buzzerOrder'] = []
        state_changed = True
    elif msg_type == 'BUZZER_ORDER':
        server_state['buzzerOrder'] = data.get('order', [])
        state_changed = True
    elif msg_type == 'RESET_GAME':
        server_state['answeredClues'] = []
        server_state['buzzerOrder'] = []
        server_state['activeOverlay'] = None
        for team in server_state['teams']:
            team['score'] = 0
        state_changed = True

    # Save to disk if any core data was updated
    if state_changed:
        save_state()

    # Broadcast to everyone else
    emit('game_event', data, broadcast=True, include_self=False)

if __name__ == '__main__':
    print("=========================================")
    print("Trivia Server Running!")
    print("Host locally at: http://localhost:5000")
    print("Ensure Tailscale is connected for remote players.")
    print("=========================================")
    socketio.run(app, host='0.0.0.0', port=5000)