/* Shared helpers used by the moderator, builder, big screen and buzzer pages. */
(function (global) {
    'use strict';

    // ---------- DOM helpers ----------
    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

    /** el('div', {class:'x', onclick: fn, text:'hi'}, child1, child2) */
    function el(tag, props, ...kids) {
        const node = document.createElement(tag);
        for (const [key, val] of Object.entries(props || {})) {
            if (val === false || val == null) continue;
            if (key === 'class') node.className = val;
            else if (key === 'text') node.textContent = val;
            else if (key === 'style') node.style.cssText = val;
            else if (key === 'dataset') Object.assign(node.dataset, val);
            else if (key.startsWith('on') && typeof val === 'function') node.addEventListener(key.slice(2), val);
            else node.setAttribute(key, val === true ? '' : val);
        }
        kids.flat().forEach(kid => {
            if (kid == null || kid === false) return;
            node.append(kid.nodeType ? kid : document.createTextNode(kid));
        });
        return node;
    }

    // ---------- Text safety ----------
    const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);

    const KEEP_TAGS = new Set(['B', 'I', 'U', 'EM', 'STRONG', 'BR', 'SUB', 'SUP', 'SMALL', 'MARK']);
    const DROP_TAGS = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'IMG', 'SVG', 'MATH']);

    function cleanNode(node) {
        Array.from(node.childNodes).forEach(child => {
            if (child.nodeType === 3) return;
            if (child.nodeType !== 1) { child.remove(); return; }
            cleanNode(child);
            if (DROP_TAGS.has(child.tagName)) { child.remove(); return; }
            if (!KEEP_TAGS.has(child.tagName)) { child.replaceWith(...child.childNodes); return; }
            Array.from(child.attributes).forEach(a => child.removeAttribute(a.name));
        });
    }

    /**
     * Turns clue text into safe HTML. Newlines become <br>, simple formatting
     * tags (<b>, <i>, <u>, <em>, <strong>, <sub>, <sup>...) that older game
     * files may contain still work, everything else (scripts, handlers,
     * attributes) is stripped.
     */
    function safeHtml(input) {
        const tpl = document.createElement('template');
        tpl.innerHTML = String(input ?? '').replace(/\r?\n/g, '<br>');
        cleanNode(tpl.content);
        return tpl.innerHTML;
    }

    // ---------- Game file handling ----------
    const CLUE_DEFAULTS = { type: 'text', url: '', prompt: '', response: '', responseType: 'text', responseUrl: '' };

    /**
     * Makes a loaded game.json safe to render without ever removing or
     * renaming a key, so every older game file keeps working.
     * Throws a readable Error if the file isn't a game at all.
     */
    function normalizeGame(data) {
        if (!data || typeof data !== 'object' || !Array.isArray(data.categories) || data.categories.length === 0) {
            throw new Error('This file has no "categories" list, so it isn\'t a game.json.');
        }
        data.categories.forEach((cat, c) => {
            if (!cat || typeof cat !== 'object') data.categories[c] = cat = {};
            cat.name = String(cat.name ?? `Category ${c + 1}`);
            if (!Array.isArray(cat.clues)) cat.clues = [];
            cat.clues = cat.clues.map((raw, r) => {
                const clue = { ...CLUE_DEFAULTS, points: (r + 1) * 100, ...(raw || {}) };
                clue.type = clue.type || 'text';
                clue.responseType = clue.responseType || 'text';
                clue.url = clue.url || '';
                clue.responseUrl = clue.responseUrl || '';
                clue.prompt = String(clue.prompt ?? '');
                clue.response = String(clue.response ?? '');
                if (clue.points == null || clue.points === '') clue.points = (r + 1) * 100;
                return clue;
            });
        });
        return data;
    }

    const gameRows = data => Math.max(0, ...data.categories.map(c => c.clues.length));
    const clueId = (col, row) => `clue-${col}-${row}`;
    function parseClueId(id) {
        const m = /^clue-(\d+)-(\d+)$/.exec(id || '');
        return m ? { col: +m[1], row: +m[2] } : null;
    }

    function readJsonFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error('Could not read the file.'));
            reader.onload = () => {
                try { resolve(JSON.parse(reader.result)); }
                catch { reject(new Error('That file is not valid JSON.')); }
            };
            reader.readAsText(file);
        });
    }

    function downloadJson(obj, filename) {
        const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = el('a', { href: url, download: filename });
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    // ---------- Media URL helpers ----------
    const splitUrls = str => String(str || '').split(',').map(u => u.trim()).filter(Boolean);
    const youtubeId = url => (/(?:[?&]v=|youtu\.be\/|embed\/|shorts\/|live\/)([\w-]{6,})/.exec(url || '') || [])[1] || '';
    const spotifyTrackId = url => (/track[/:]([A-Za-z0-9]+)/.exec(url || '') || [])[1] || '';

    // ---------- Toasts ----------
    function toast(message, opts = {}) {
        let host = document.getElementById('toast-host');
        if (!host) { host = el('div', { id: 'toast-host' }); document.body.append(host); }
        const node = el('div', { class: `toast ${opts.type || ''}`, role: 'status' }, el('span', { text: message }));
        const remove = () => node.remove();
        if (opts.action) {
            node.append(el('button', {
                text: opts.action,
                onclick: () => { remove(); opts.onAction && opts.onAction(); }
            }));
        }
        host.append(node);
        setTimeout(remove, opts.ms || (opts.action ? 7000 : 3000));
        return node;
    }

    // ---------- Socket status pill ----------
    function bindConnectionPill(socket, pill) {
        const set = (ok, label) => {
            pill.className = `pill ${ok ? 'ok' : 'bad'}`;
            pill.innerHTML = '<span class="dot"></span>';
            pill.append(label);
        };
        set(socket.connected, socket.connected ? 'Connected' : 'Connecting…');
        socket.on('connect', () => set(true, 'Connected'));
        socket.on('disconnect', () => set(false, 'Disconnected'));
        socket.on('connect_error', () => set(false, 'Server unreachable'));
    }

    // True while the user is typing, so keyboard shortcuts stay out of the way.
    const isTyping = () => {
        const t = document.activeElement;
        return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    };

    global.Common = {
        $, $$, el, esc, safeHtml, normalizeGame, gameRows, clueId, parseClueId,
        readJsonFile, downloadJson, splitUrls, youtubeId, spotifyTrackId,
        toast, bindConnectionPill, isTyping
    };
})(window);
