# Trivia Night (jeopardy-Player)

A Jeopardy-style trivia host for live games: one **moderator** console, one **big screen** for the audience,
and optional **phone buzzers**. A small Flask + Socket.IO server keeps every screen in sync and remembers the
game, so refreshing any page (or restarting the server) never loses progress.

## Quick start

```bash
pip install -r requirements.txt
python server.py
```

The server prints the addresses to use:

| Page | URL | Who |
|------|-----|-----|
| Moderator | `/moderator.html` | host (laptop) |
| Big screen | `/player.html` | projector / second monitor |
| Phone buzzer | `/buzzer.html` | players (use the LAN address printed at start-up, or **Copy phone link** in the moderator) |
| Builder | `/builder.html` | write a `game.json` |

Lyrics mode has its own set: `lyrics_builder.html`, `lyrics_moderator.html`, `lyrics_player.html`, `lyrics_buzzer.html`.

> The pages load the Socket.IO client from `cdn.socket.io`, so the host machine and phones need internet access
> (or save that script locally and change the `<script>` tag).

## Running a game

1. Build a game in the **Builder** and export `game.json` (or use an existing one).
2. In the **Moderator**, click **Load game** (or drag the file onto the page).
3. Click **Big screen** and move that window to the projector. Players open the phone link and pick a team.
4. Click a tile. The prompt appears on the big screen and the buzzers open. Judge with **✓ / ✗**, reveal the
   answer, close the clue.

### Daily Double
The moderator can choose how it is picked (only you ever see it):
* **🎲 Random** – a random unplayed tile (click again to re-roll).
* **✋ Choose tile** – click any unplayed tile on the board.
* **None** – play without one.

The Builder can also pre-select it (tick *Daily Double* inside a clue); the moderator then respects that choice.
When a Daily Double is opened the buzzers stay closed; use **💰 Ask wager** and the +/− buttons use the wager.

### Keyboard shortcuts (moderator)
`P` show prompt · `A` reveal answer · `C` close clue · `Z` zoom images · `T` start/pause timer · `Esc` cancel picking a Daily Double.
Lyrics moderator: `←`/`→` snippets · `H` hint · `A` reveal · `N` next round.

## Builder
* Click a tile to edit it; **Save & next** walks down the board for fast entry.
* **🔀 at the start of each row** shuffles that row's clues across the categories (point values stay in place;
  a pre-selected Daily Double moves with its clue). **Undo** (button or Ctrl+Z) reverts it.
* Drafts autosave in the browser; you are warned before leaving with unexported changes.

## File formats (unchanged, fully backward compatible)

```jsonc
// game.json
{
  "gameTitle": "…",
  "finalJeopardy": { "category": "", "type": "text", "url": "", "prompt": "", "answer": "", "responseType": "text", "responseUrl": "" },
  "categories": [
    { "name": "…", "clues": [ { "type": "text|image|video|audio|youtube|spotify", "url": "", "prompt": "", "response": "",
                                "responseType": "text|image|video", "responseUrl": "", "points": 100 } ] }
  ],
  "dailyDoubleId": "clue-2-3"   // optional; "clue-<column>-<row>", zero-based. null = no Daily Double
}
// lyrics_game.json
{ "title": "…", "rounds": [ { "lyrics": ["snippet", "…"], "answer": "…" } ] }   // "lyrics" may also be a single string
```
Missing fields are filled in with defaults on load; nothing is ever removed. Image URLs may be comma-separated.
Basic formatting tags (`<b> <i> <u> <em> <strong> <sub> <sup> <br>`) in prompts/answers still work; anything else is stripped.
Local media (e.g. `media/clip.mp4`) is served from this folder.

## Notes
* `game_save.json` is the server's live save. Delete it to start completely fresh.
* Only web assets (`.html .css .js`, images, audio/video) are served; `game_save.json`, `server.py` and dot-files are not downloadable.
* Players' phones receive the same live data as every screen, so a determined player could read answers from
  the browser's network tab. This is fine for friendly games; it is not cheat-proof.
