from flask import Flask, send_from_directory
from flask_socketio import SocketIO, emit
import os

app = Flask(__name__, static_folder='.')
app.config['SECRET_KEY'] = 'jeopardy_secret!'
# Allow connections from any IP (crucial for Tailscale)
socketio = SocketIO(app, cors_allowed_origins="*")

# Serve the Moderator screen as the default homepage
@app.route('/')
def index():
    return send_from_directory('.', 'player.html')

# Serve all other files (HTML, CSS, JS, JSON)
@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory('.', path)

# Listen for game events and beam them to everyone else
@socketio.on('game_event')
def handle_game_event(data):
    # broadcast=True sends it to all connected clients
    # include_self=False ensures the sender doesn't receive their own echo
    emit('game_event', data, broadcast=True, include_self=False)

if __name__ == '__main__':
    print("=========================================")
    print("Trivia Server Running!")
    print("Host locally at: http://localhost:5000")
    print("Ensure Tailscale is connected for remote players.")
    print("=========================================")
    # host='0.0.0.0' is REQUIRED to allow Tailscale network access
    socketio.run(app, host='0.0.0.0', port=5000)