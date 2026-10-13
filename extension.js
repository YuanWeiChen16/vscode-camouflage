// Background Text — 在編輯器背景顯示半透明文字。
//
// 作法：VS Code 沒有正式的「編輯器背景」API，這裡用 TextEditorDecoration 的
// `before` 附件掛在畫面中間那一行，並透過 textDecoration 注入
// `position:absolute` 等 CSS，讓文字脫離排版、浮在程式碼後面。
// 捲動時把裝飾移到新的中間行，看起來就像固定在背景上。
// 好處是不需要改 VS Code 安裝目錄的 workbench 檔案，不會出現「安裝已損毀」警告。

const vscode = require('vscode');

const SECTION = 'backgroundText';

/** @type {vscode.TextEditorDecorationType | undefined} */
let decorationType;

// 去掉可能跳出 CSS 宣告的字元，避免設定值破壞注入的樣式
function cssValue(value, fallback) {
    const text = String(value ?? '').replace(/[;{}<>]/g, '').trim();
    return text || fallback;
}

// 留空 → 佈景主題文字色；看起來像 CSS 顏色 → 直接用；其餘視為佈景主題色 ID。
// ThemeColor 會被轉成 CSS 變數，切換佈景主題時自動跟著變。
function resolveColor(value) {
    const text = String(value ?? '').trim();
    if (!text) return new vscode.ThemeColor('editor.foreground');
    if (/^(#|rgb|hsl)/i.test(text) || /^[a-z]+$/i.test(text)) return cssValue(text, '#888888');
    return new vscode.ThemeColor(text);
}

// 亂碼模式預設調色盤：取佈景主題裡接近語法上色的顏色，換主題會跟著變
const DEFAULT_PALETTE = [
    'editor.foreground',
    'debugTokenExpression.name',
    'debugTokenExpression.value',
    'debugTokenExpression.string',
    'debugTokenExpression.number',
    'debugTokenExpression.boolean',
    'symbolIcon.functionForeground',
    'symbolIcon.classForeground',
    'symbolIcon.variableForeground',
    'terminal.ansiBrightBlue',
    'terminal.ansiYellow',
    'terminal.ansiCyan',
    'terminal.ansiGreen',
];

// 調色盤留空 → 只用 backgroundText.color 這一色
function paletteList(palette, color) {
    const list = Array.isArray(palette) ? palette.filter((p) => String(p).trim()) : [];
    return (list.length ? list : [color]).map(paletteColor);
}

function getConfig() {
    const c = vscode.workspace.getConfiguration(SECTION);
    return {
        enabled: c.get('enabled', true),
        mode: c.get('mode', 'text'),
        charset: Array.from(String(c.get('random.charset', '')) || '01'),
        columns: Math.max(10, Number(c.get('random.columns', 200)) || 200),
        refreshInterval: Math.max(0, Number(c.get('random.refreshInterval', 0)) || 0),
        lines: c.get('lines', ['Hello, VS Code']).map(String),
        color: resolveColor(c.get('color', '')),
        opacity: Math.min(1, Math.max(0, Number(c.get('opacity', 1)))),
        documentRatio: Math.min(1, Math.max(0, Number(c.get('random.documentRatio', 0.7)))),
        palette: paletteList(c.get('random.palette', DEFAULT_PALETTE), c.get('color', '')),
        fragmentMin: Math.max(1, Number(c.get('random.fragmentMin', 4)) || 4),
        fragmentMax: Math.max(1, Number(c.get('random.fragmentMin', 4)) || 4, Number(c.get('random.fragmentMax', 16)) || 16),
        fontSize: cssValue(c.get('fontSize'), '48px'),
        fontWeight: cssValue(c.get('fontWeight'), 'bold'),
        lineSpacing: Number(c.get('lineSpacing', 1.2)) || 1.2,
        left: cssValue(c.get('left'), '20vw'),
        verticalOffset: cssValue(c.get('verticalOffset'), '-1em'),
        rotate: Number(c.get('rotate', 0)) || 0,
    };
}

function createDecorationType() {
    decorationType?.dispose();
    // 實際樣式放在每個 decoration 的 renderOptions，這裡只建立空的類型
    decorationType = vscode.window.createTextEditorDecorationType({
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    });
}

/** 產生第 index 行文字要注入的 CSS（接在 textDecoration 後面） */
function buildCss(cfg, index) {
    const top = `calc(${cfg.verticalOffset} + ${index * cfg.lineSpacing} * ${cfg.fontSize})`;
    return [
        'none',
        'position: absolute',
        `top: ${top}`,
        `left: ${cfg.left}`,
        `font-size: ${cfg.fontSize}`,
        `font-weight: ${cfg.fontWeight}`,
        `line-height: ${cfg.lineSpacing}`,
        `opacity: ${cfg.opacity}`,
        `transform: rotate(${cfg.rotate}deg)`,
        'transform-origin: left top',
        'white-space: pre',
        'pointer-events: none',
        'user-select: none',
    ].join('; ');
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const randInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

// 全形字（中日韓、全形符號、emoji）佔 2 格，其餘 1 格；半形片假名 FF61–FF9F 不在範圍內
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|[\u{10000}-\u{10FFFF}]/u;
const charWidth = (ch) => (WIDE.test(ch) ? 2 : 1);

// 佈景主題色 ID（例如 symbolIcon.functionForeground）→ CSS 變數；CSS 顏色直接用
function paletteColor(value) {
    const text = cssValue(value, '');
    if (!text) return 'var(--vscode-editor-foreground)';
    if (/^(#|rgb|hsl)/i.test(text)) return text;
    return `var(--vscode-${text.replace(/\./g, '-')}, var(--vscode-editor-foreground))`;
}

/**
 * 產生一列亂碼，寬度 columns 格。一段一段拼：每段以 documentRatio 的機率
 * 從檔案隨機位置擷取一小段「連續」字串（保留原本的單字、符號組合），
 * 其餘用 charset 亂碼補；每段配一個調色盤顏色，做成類似語法上色的效果。
 * 回傳各段：{ text, color, from（起始格）, width（佔幾格）}。
 * 每段之後各自用真正的 color 繪製（不用漸層 + background-clip:text，
 * 那樣 Chromium 會關掉 ClearType，字看起來比正文細、暗）。
 */
function makeRow(cfg, docChars, columns) {
    const useDoc = docChars.length > 0 ? cfg.documentRatio : 0;
    const segments = [];
    let width = 0;
    while (width < columns) {
        const len = randInt(cfg.fragmentMin, cfg.fragmentMax);
        let piece;
        if (Math.random() < useDoc) {
            const start = Math.floor(Math.random() * Math.max(1, docChars.length - len));
            piece = docChars.slice(start, start + len);
        } else {
            piece = Array.from({ length: len }, () => pick(cfg.charset));
        }
        const from = width;
        let text = '';
        for (const ch of piece) {
            if (width >= columns) break;
            text += ch;
            width += charWidth(ch);
        }
        if (!text) continue;
        const color = pick(cfg.palette);
        const prev = segments[segments.length - 1];
        // 相鄰同色就併成一段，減少裝飾數量
        if (prev && prev.color === color) {
            prev.text += text;
            prev.width = width - prev.from;
        } else {
            segments.push({ text, color, from, width: width - from });
        }
    }
    return { segments };
}

// 取出檔案文字（空白壓成一個，避免擷取到整段縮排；太大的檔案只取前段）。
// 用 Array.from 以免切斷中文等多位元組字元。
/** @param {vscode.TextDocument} document */
function documentChars(document) {
    return Array.from(document.getText().slice(0, 200000).replace(/\s+/g, ' ').trim());
}

/**
 * 每個檔案各自快取亂碼（依行號），捲動時重用，避免一捲動就換一批。
 * 用到哪一行才產生哪一行，大檔案也不會一次產生全部。
 * @type {Map<string, { docChars: string[], lead: Map<number, any>, trail: Map<number, any> }>}
 */
let randomRows = new Map();

/** @param {vscode.TextDocument} document */
function rowCache(cfg, document) {
    const key = document.uri.toString();
    let cache = randomRows.get(key);
    if (!cache) {
        cache = {
            docChars: cfg.documentRatio > 0 ? documentChars(document) : [],
            lead: new Map(),
            trail: new Map(),
        };
        randomRows.set(key, cache);
    }
    return cache;
}

// 取第 index 列的亂碼；縮排寬度變了（編輯過）就重產
function cachedRow(cfg, cache, kind, index, columns) {
    let row = cache[kind].get(index);
    if (!row || row.columns !== columns) {
        row = { columns, ...makeRow(cfg, cache.docChars, columns) };
        cache[kind].set(index, row);
    }
    return row;
}

// 可見範圍上下多鋪的行數，捲動時新露出的行已經有亂碼，不會閃
const SCROLL_BUFFER = 15;
// 文件結尾以下補幾列，讓空白區也鋪滿
const TAIL_ROWS = 60;

// 亂碼每一段的樣式（顏色用 CSS 變數，跟著佈景主題變）
function segmentCss(cfg, seg, extra) {
    return [
        'none',
        'position: absolute',
        ...extra,
        `color: ${seg.color}`,
        `opacity: ${cfg.opacity}`,
        'white-space: pre',
        'pointer-events: none',
        'user-select: none',
    ].join('; ');
}

/**
 * 把一列亂碼的每一段各推成一個裝飾。
 * placeFn(seg) 回傳該段的定位 CSS（null = 這段不畫）。
 */
function pushRow(options, cfg, range, attach, row, placeFn) {
    for (const seg of row.segments) {
        const place = placeFn(seg);
        if (!place) continue;
        options.push({
            range,
            renderOptions: {
                [attach]: { contentText: seg.text, textDecoration: segmentCss(cfg, seg, place) },
            },
        });
    }
}

// 這一行開頭的縮排佔幾格（Tab 依 tabSize 展開）
function indentColumns(text, tabSize) {
    let col = 0;
    for (const ch of text) {
        if (ch === ' ') col++;
        else if (ch === '\t') col += tabSize - (col % tabSize);
        else break;
    }
    return col;
}

/**
 * 亂碼模式：逐行處理，只鋪「沒有字」的地方，不蓋到任何真正的文字：
 *  - 行首縮排：before 附件，用 left 依序排開，超出縮排寬度的部分裁掉
 *  - 行尾之後：after 附件，position:absolute 但不給 left → 停在原本行尾的位置，
 *    再用 margin-left 依序往右排；也不會撐寬編輯器的水平捲軸
 *  - 文件結尾以下：掛在最後一行，往下逐列補滿
 * 每行對應固定的亂碼，所以會跟著內容一起捲動。
 * @param {vscode.TextEditor} editor
 */
function renderRandom(editor, cfg) {
    const document = editor.document;
    const lastLine = document.lineCount - 1;
    const ranges = editor.visibleRanges;
    const first = ranges.length ? ranges[0].start.line : 0;
    const last = ranges.length ? ranges[ranges.length - 1].end.line : 0;
    const from = Math.max(0, first - SCROLL_BUFFER);
    const to = Math.min(lastLine, last + SCROLL_BUFFER);
    const tabSize = Number(editor.options.tabSize) || 4;
    const cache = rowCache(cfg, document);

    const options = [];
    for (let line = from; line <= to; line++) {
        const textLine = document.lineAt(line);
        const indent = textLine.isEmptyOrWhitespace ? 0 : indentColumns(textLine.text, tabSize);

        if (indent > 0) {
            const row = cachedRow(cfg, cache, 'lead', line, indent);
            pushRow(options, cfg, new vscode.Range(line, 0, line, 0), 'before', row, (seg) => {
                if (seg.from >= indent) return null;
                const place = ['top: 0', `left: ${seg.from}ch`];
                // 最後一段若有全形字超出縮排，就裁掉，避免蓋到正文
                if (seg.from + seg.width > indent) {
                    place.push(`width: ${indent - seg.from}ch`, 'overflow: hidden');
                }
                return place;
            });
        }

        const end = textLine.range.end;
        const row = cachedRow(cfg, cache, 'trail', line, cfg.columns);
        pushRow(options, cfg, new vscode.Range(end, end), 'after', row, (seg) =>
            seg.from > 0 ? [`margin-left: ${seg.from}ch`] : [],
        );
    }

    // 接近文件結尾時，在最後一行下方往下補列
    if (to === lastLine) {
        const anchor = new vscode.Range(lastLine, 0, lastLine, 0);
        for (let k = 1; k <= TAIL_ROWS; k++) {
            const row = cachedRow(cfg, cache, 'trail', lastLine + k, cfg.columns);
            pushRow(options, cfg, anchor, 'before', row, (seg) => [
                `top: calc(${k} * 1lh)`,
                `left: ${seg.from}ch`,
            ]);
        }
    }
    editor.setDecorations(decorationType, options);
}

/** @param {vscode.TextEditor} editor */
function render(editor) {
    if (!decorationType || !editor) return;
    const cfg = getConfig();
    if (!cfg.enabled) {
        editor.setDecorations(decorationType, []);
        return;
    }
    if (cfg.mode === 'random') {
        renderRandom(editor, cfg);
        return;
    }
    if (cfg.lines.length === 0) {
        editor.setDecorations(decorationType, []);
        return;
    }

    // 以目前可見範圍的中間行當錨點
    const visible = editor.visibleRanges[0];
    const lastLine = editor.document.lineCount - 1;
    let anchor = 0;
    if (visible) {
        anchor = Math.floor((visible.start.line + visible.end.line) / 2);
    }
    anchor = Math.min(Math.max(anchor, 0), lastLine);
    const range = new vscode.Range(anchor, 0, anchor, 0);

    const options = cfg.lines.map((line, i) => ({
        range,
        renderOptions: {
            before: {
                contentText: line.length ? line : ' ',
                color: cfg.color,
                textDecoration: buildCss(cfg, i),
            },
        },
    }));
    editor.setDecorations(decorationType, options);
}

function renderAll() {
    for (const editor of vscode.window.visibleTextEditors) render(editor);
}

/** @type {NodeJS.Timeout | undefined} */
let refreshTimer;

// 亂碼模式且有設定間隔時，定時重畫讓亂碼持續變化
function restartTimer() {
    clearInterval(refreshTimer);
    refreshTimer = undefined;
    const cfg = getConfig();
    if (cfg.enabled && cfg.mode === 'random' && cfg.refreshInterval > 0) {
        refreshTimer = setInterval(() => {
            randomRows = new Map();
            renderAll();
        }, Math.max(50, cfg.refreshInterval));
    }
}

/** @param {vscode.ExtensionContext} context */
function activate(context) {
    createDecorationType();

    context.subscriptions.push(
        { dispose: () => decorationType?.dispose() },
        { dispose: () => clearInterval(refreshTimer) },

        vscode.window.onDidChangeVisibleTextEditors(renderAll),
        vscode.window.onDidChangeTextEditorVisibleRanges((e) => render(e.textEditor)),
        vscode.workspace.onDidChangeTextDocument((e) => {
            for (const editor of vscode.window.visibleTextEditors) {
                if (editor.document === e.document) render(editor);
            }
        }),
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration(SECTION)) {
                randomRows = new Map();
                restartTimer();
                renderAll();
            }
        }),

        vscode.commands.registerCommand('backgroundText.toggle', async () => {
            const c = vscode.workspace.getConfiguration(SECTION);
            await c.update('enabled', !c.get('enabled', true), vscode.ConfigurationTarget.Global);
        }),

        vscode.commands.registerCommand('backgroundText.setText', async () => {
            const c = vscode.workspace.getConfiguration(SECTION);
            const current = c.get('lines', []).join('\\n');
            const input = await vscode.window.showInputBox({
                prompt: '輸入背景文字，用 \\n 分隔多行',
                value: current,
            });
            if (input === undefined) return;
            const lines = input.split('\\n');
            await c.update('lines', lines, vscode.ConfigurationTarget.Global);
            await c.update('enabled', true, vscode.ConfigurationTarget.Global);
        }),
    );

    restartTimer();
    renderAll();
}

function deactivate() {}

module.exports = { activate, deactivate };
