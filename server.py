"""Trivia game server: Flask + Socket.IO.

Run with:  python server.py   (then open http://localhost:5000/moderator.html)

The server is the single source of truth for game state, so a refreshed or
reconnecting screen (moderator, big screen, buzzer phone) is restored exactly
as it was.  Game files (game.json / lyrics_game.json) are never changed or
re-formatted here; they are stored and relayed as received.
"""
import json
import os
import socket
import tempfile
import threading

from flask import Flask, abort, jsonify, send_from_directory
from flask_socketio import SocketIO, emit

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SAVE_FILE = os.path.join(BASE_DIR, 'game_save.json')
PORT = 5000

app = Flask(__name__, static_folder=None)
app.config['SECRET_KEY'] = 'jeopardy_secret!'
socketio = SocketIO(app, cors_allowed_origins='*')

# --------------------------------------------------------------------------
# Static files: allow-list only.  Previously *every* file in this folder was
# downloadable by any player on the network, including game_save.json (which
# contains every answer) and this source file.
# --------------------------------------------------------------------------
ALLOWED_EXTENSIONS = {
    '.html', '.css', '.js',
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico',
    '.mp3', '.wav', '.ogg', '.m4a', '.mp4', '.webm',
}


@app.route('/')
def index():
    return send_from_directory(BASE_DIR, 'player.html')


@app.route('/lan-info')
def lan_info():
    ip = lan_address()
    return jsonify({'buzzer': f'http://{ip}:{PORT}/buzzer.html' if ip else None})


@app.route('/<path:path>')
def serve_static(path):
    parts = path.split('/')
    if any(p.startswith('.') or p == '' for p in parts):
        abort(404)
    if os.path.splitext(path)[1].lower() not in ALLOWED_EXTENSIONS:
        abort(404)
    return send_from_directory(BASE_DIR, path)


# --------------------------------------------------------------------------
# State
# --------------------------------------------------------------------------
def default_lyrics_state():
    return {
        'gameData': None,
        'currentRound': 0,
        'currentLyricSection': 0,
        'hintsRevealed': 0,
        'answerRevealed': False,
        'submissions': {},
        'scores': {},
    }


def default_state():
    return {
        'gameData': None,
        'teams': [
            {'name': 'Team 1', 'score': 0},
            {'name': 'Team 2', 'score': 0},
            {'name': 'Team 3', 'score': 0},
        ],
        'answeredClues': [],
        'buzzerOrder': [],
        'buzzersEnabled': False,
        'activeOverlay': None,   # last SHOW_* message, replayed on (re)connect
        'answerOverlay': None,   # last SHOW_ANSWER / SHOW_FJ_ANSWER message
        'claimedTeams': [],
        'teamWagers': {},
        'lyricsState': default_lyrics_state(),
    }


lock = threading.RLock()
server_state = default_state()


def load_state():
    """Load a previous save, filling in any keys an older save file lacks."""
    global server_state
    if not os.path.exists(SAVE_FILE):
        return
    try:
        with open(SAVE_FILE, 'r', encoding='utf-8') as f:
            saved = json.load(f)
        merged = default_state()
        merged.update(saved)
        merged['lyricsState'] = {**default_lyrics_state(), **(saved.get('lyricsState') or {})}
        server_state = merged
        print('Game state loaded from disk.')
    except Exception as exc:  # corrupt/unreadable save: start fresh
        print('Error loading state from disk:', exc)


def save_state():
    """Atomic write so a crash mid-save can never corrupt the save file."""
    try:
        fd, tmp = tempfile.mkstemp(dir=BASE_DIR, suffix='.tmp')
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(server_state, f)
        os.replace(tmp, SAVE_FILE)
    except Exception as exc:
        print('Error saving state to disk:', exc)


load_state()


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
def to_all(payload):
    emit('game_event', payload, broadcast=True)


def to_others(payload):
    emit('game_event', payload, broadcast=True, include_self=False)


def to_sender(payload):
    emit('game_event', payload)


def clear_round_state(s):
    s['buzzerOrder'] = []
    s['buzzersEnabled'] = False
    s['activeOverlay'] = None
    s['answerOverlay'] = None


def lyrics_changed():
    to_all({'type': 'UPDATE_LYRICS_STATE', 'state': server_state['lyricsState']})


# --------------------------------------------------------------------------
# Main-game handlers.  Each returns True when persistent state changed.
# Anything not handled specially (timer ticks, zoom, audio...) is simply
# relayed to the other clients.
# --------------------------------------------------------------------------
def h_load_game(d):
    s = server_state
    s['gameData'] = d.get('data')
    s['answeredClues'] = []
    s['teamWagers'] = {}
    clear_round_state(s)
    return True


def h_set_daily_double(d):
    gd = server_state['gameData']
    if gd is not None:
        gd['dailyDoubleId'] = d.get('id')
        return True
    return False


def h_show_clue(d):
    """SHOW_PROMPT / SHOW_DAILY_DOUBLE / SHOW_FJ_CATEGORY / SHOW_FJ_PROMPT."""
    s = server_state
    previous = s['activeOverlay'] or {}
    clue_id = d.get('clueId')
    if not clue_id and d.get('type') in ('SHOW_PROMPT', 'SHOW_DAILY_DOUBLE'):
        clue_id = previous.get('clueId')
        if clue_id:
            d['clueId'] = clue_id
    if clue_id and clue_id not in s['answeredClues']:
        s['answeredClues'].append(clue_id)
    s['activeOverlay'] = d
    s['answerOverlay'] = None
    return True


def h_show_answer(d):
    server_state['answerOverlay'] = d
    return True


def h_close_clue(d):
    clear_round_state(server_state)
    server_state['teamWagers'] = {}
    return True


def h_reset_game(d):
    s = server_state
    s['answeredClues'] = []
    s['teamWagers'] = {}
    for team in s['teams']:
        team['score'] = 0
    clear_round_state(s)
    return True


def h_update_scores(d):
    server_state['teams'] = d.get('teams', server_state['teams'])
    return True


def h_enable_buzzers(d):
    server_state['buzzerOrder'] = []
    server_state['buzzersEnabled'] = True
    return True


def h_disable_buzzers(d):
    server_state['buzzersEnabled'] = False
    return True


def h_buzzer_order(d):
    server_state['buzzerOrder'] = list(d.get('order') or [])
    return True


def h_submit_wager(d):
    team = d.get('team')
    if team:
        server_state['teamWagers'][team] = d.get('wager', 0)
        return True
    return False


def h_clear_wager(d):
    server_state['teamWagers'].pop(d.get('team'), None)
    return True


def broadcast_claims():
    to_all({'type': 'UPDATE_CLAIMS', 'claimedTeams': server_state['claimedTeams']})


# --------------------------------------------------------------------------
# Lyrics-game handlers
# --------------------------------------------------------------------------
def lyric_points(stage):
    return 4 - stage


def h_load_lyrics(d):
    ls = server_state['lyricsState']
    ls.update(gameData=d.get('data'), currentRound=0, currentLyricSection=0,
              hintsRevealed=0, answerRevealed=False, submissions={})
    return True


def h_cycle_lyrics(d):
    ls = server_state['lyricsState']
    rounds = (ls['gameData'] or {}).get('rounds', [])
    if ls['currentRound'] < len(rounds):
        snippets = rounds[ls['currentRound']].get('lyrics', [])
        if snippets:
            idx = ls.get('currentLyricSection', 0) + int(d.get('direction', 1))
            ls['currentLyricSection'] = max(0, min(len(snippets) - 1, idx))
            return True
    return False


def h_reveal_hint(d):
    ls = server_state['lyricsState']
    if ls['hintsRevealed'] < 3:
        ls['hintsRevealed'] += 1
        return True
    return False


def h_submit_lyrics(d):
    ls = server_state['lyricsState']
    team = d.get('team')
    if team and team not in ls['submissions']:
        ls['submissions'][team] = {
            'answer': d.get('answer'),
            'stage': ls['hintsRevealed'],
            'status': 'PENDING',
            'applied': 0,
        }
        return True
    return False


def _applied_delta(sub):
    """Points already applied for a submission (older saves lack 'applied')."""
    if 'applied' in sub:
        return sub['applied']
    pts = lyric_points(sub['stage'])
    return {'CORRECT': pts, 'INCORRECT': -pts}.get(sub.get('status'), 0)


def h_grade_lyrics(d):
    """Grading is idempotent: re-grading corrects the score instead of
    adding the points a second time."""
    ls = server_state['lyricsState']
    team = d.get('team')
    sub = ls['submissions'].get(team)
    if not sub:
        return False
    pts = lyric_points(sub['stage'])
    correct = bool(d.get('isCorrect'))
    new_delta = pts if correct else -pts
    ls['scores'][team] = ls['scores'].get(team, 0) + new_delta - _applied_delta(sub)
    sub['applied'] = new_delta
    sub['status'] = 'CORRECT' if correct else 'INCORRECT'
    return True


def h_adjust_lyrics(d):
    ls = server_state['lyricsState']
    team = d.get('team')
    if team:
        ls['scores'][team] = ls['scores'].get(team, 0) + int(d.get('amount', 0))
        return True
    return False


def h_reveal_lyrics_answer(d):
    server_state['lyricsState']['answerRevealed'] = True
    return True


def h_change_lyrics_round(delta):
    def handler(d):
        ls = server_state['lyricsState']
        total = len((ls['gameData'] or {}).get('rounds', []))
        new_round = max(0, min(total, ls['currentRound'] + delta))
        if new_round == ls['currentRound']:
            return False
        ls.update(currentRound=new_round, currentLyricSection=0, hintsRevealed=0,
                  answerRevealed=False, submissions={})
        return True
    return handler


LYRICS_HANDLERS = {
    'LOAD_LYRICS_GAME': h_load_lyrics,
    'CYCLE_LYRICS_SECTION': h_cycle_lyrics,
    'REVEAL_LYRICS_HINT': h_reveal_hint,
    'SUBMIT_LYRICS_ANSWER': h_submit_lyrics,
    'GRADE_LYRICS_SUBMISSION': h_grade_lyrics,
    'ADJUST_LYRICS_SCORE': h_adjust_lyrics,
    'REVEAL_LYRICS_ANSWER': h_reveal_lyrics_answer,
    'NEXT_LYRICS_ROUND': h_change_lyrics_round(+1),
    'PREV_LYRICS_ROUND': h_change_lyrics_round(-1),
}

GAME_HANDLERS = {
    'LOAD_GAME': h_load_game,
    'SET_DAILY_DOUBLE': h_set_daily_double,
    'SHOW_PROMPT': h_show_clue,
    'SHOW_DAILY_DOUBLE': h_show_clue,
    'SHOW_FJ_CATEGORY': h_show_clue,
    'SHOW_FJ_PROMPT': h_show_clue,
    'SHOW_ANSWER': h_show_answer,
    'SHOW_FJ_ANSWER': h_show_answer,
    'CLOSE_CLUE': h_close_clue,
    'RESET_GAME': h_reset_game,
    'UPDATE_SCORES': h_update_scores,
    'ENABLE_BUZZERS': h_enable_buzzers,
    'DISABLE_BUZZERS': h_disable_buzzers,
    'BUZZER_ORDER': h_buzzer_order,
    'SUBMIT_WAGER': h_submit_wager,
    'CLEAR_WAGER': h_clear_wager,
}


# --------------------------------------------------------------------------
# Socket events
# --------------------------------------------------------------------------
@socketio.on('connect')
def handle_connect():
    with lock:
        to_sender({'type': 'SYNC_FULL_STATE', 'state': server_state})
        to_sender({'type': 'SYNC_LYRICS_STATE', 'state': server_state['lyricsState']})


@socketio.on('game_event')
def handle_game_event(data):
    if not isinstance(data, dict):
        return
    msg_type = data.get('type')

    with lock:
        if msg_type == 'FORCE_SYNC':
            to_others({'type': 'SYNC_FULL_STATE', 'state': server_state})
            to_others({'type': 'SYNC_LYRICS_STATE', 'state': server_state['lyricsState']})
            return

        # Team claims (buzzer phones picking a team)
        if msg_type == 'CLAIM_TEAM':
            team = data.get('team')
            if team and team in server_state['claimedTeams']:
                to_sender({'type': 'CLAIM_DENIED', 'team': team})
            elif team:
                server_state['claimedTeams'].append(team)
                save_state()
            broadcast_claims()
            return
        if msg_type == 'UNCLAIM_TEAM':
            team = data.get('team')
            if team in server_state['claimedTeams']:
                server_state['claimedTeams'].remove(team)
                save_state()
            broadcast_claims()
            return
        if msg_type == 'RESET_CLAIMS':
            server_state['claimedTeams'] = []
            save_state()
            broadcast_claims()
            return

        # A buzz: the server decides the order, so network latency between the
        # moderator and the phones can never reorder who was first.
        if msg_type == 'BUZZ_IN':
            team = data.get('team')
            order = server_state['buzzerOrder']
            if server_state['buzzersEnabled'] and team and team not in order:
                order.append(team)
                save_state()
                to_all({'type': 'BUZZER_ORDER', 'order': order})
            return

        # Lyrics game
        if msg_type in LYRICS_HANDLERS:
            if LYRICS_HANDLERS[msg_type](data):
                save_state()
            lyrics_changed()
            return

        # Main game
        handler = GAME_HANDLERS.get(msg_type)
        if handler and handler(data):
            save_state()

    # Everything else (and the events above that clients render directly)
    # is relayed unchanged to the other connected screens.
    to_others(data)


def lan_address():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(('10.255.255.255', 1))
            return s.getsockname()[0]
    except OSError:
        return None


if __name__ == '__main__':
    ip = lan_address()
    print('=' * 58)
    print(' Trivia server running')
    print(f'   Moderator : http://localhost:{PORT}/moderator.html')
    print(f'   Big screen: http://localhost:{PORT}/player.html')
    if ip:
        print(f'   Phones    : http://{ip}:{PORT}/buzzer.html')
    print('=' * 58)
    socketio.run(app, host='0.0.0.0', port=PORT)
