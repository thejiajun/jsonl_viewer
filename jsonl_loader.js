import {
    filterCases,
    formatBytes,
    parseJSONL,
} from './jsonl_parser.mjs';

const DB_NAME = 'jsonl-viewer';
const STORE_NAME = 'recent-files';
const MAX_RECENT_FILES = 5;
const LAYOUT_KEY = 'jsonl-viewer-columns';

const state = {
    dataset: null,
    fileName: '',
    fileSize: 0,
    filter: 'all',
    query: '',
};

const elements = {
    dropZone: document.querySelector('#dropZone'),
    chooseButton: document.querySelector('#chooseButton'),
    fileInput: document.querySelector('#fileInput'),
    workspace: document.querySelector('#workspace'),
    fileName: document.querySelector('#fileName'),
    fileMeta: document.querySelector('#fileMeta'),
    replaceButton: document.querySelector('#replaceButton'),
    packageName: document.querySelector('#packageName'),
    packageEndpoint: document.querySelector('#packageEndpoint'),
    caseCount: document.querySelector('#caseCount'),
    mediaCount: document.querySelector('#mediaCount'),
    textOnlyCount: document.querySelector('#textOnlyCount'),
    searchInput: document.querySelector('#searchInput'),
    searchShortcut: document.querySelector('#searchShortcut'),
    filterControl: document.querySelector('#filterControl'),
    layoutControl: document.querySelector('#layoutControl'),
    resultStatus: document.querySelector('#resultStatus'),
    results: document.querySelector('#results'),
    noResults: document.querySelector('#noResults'),
    errorButton: document.querySelector('#errorButton'),
    errorPanel: document.querySelector('#errorPanel'),
    errorList: document.querySelector('#errorList'),
    closeErrorButton: document.querySelector('#closeErrorButton'),
    recentButton: document.querySelector('#recentButton'),
    recentPanel: document.querySelector('#recentPanel'),
    recentList: document.querySelector('#recentList'),
    closeRecentButton: document.querySelector('#closeRecentButton'),
    toast: document.querySelector('#toast'),
};

function createElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.hidden = false;
    window.clearTimeout(showToast.timeout);
    showToast.timeout = window.setTimeout(() => {
        elements.toast.hidden = true;
    }, 2200);
}

async function copyText(text, successMessage) {
    try {
        await navigator.clipboard.writeText(text);
        showToast(successMessage);
    } catch {
        const textarea = createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.append(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
        showToast(successMessage);
    }
}

function buildChip(text, variant = '') {
    return createElement('span', `chip${variant ? ` ${variant}` : ''}`, text);
}

function buildMediaItem(media, mediaIndex) {
    const figure = createElement('figure', 'media-item');
    const frame = createElement('div', 'media-frame');
    const label = createElement(
        'span',
        'media-label',
        media.role || `${media.type} ${mediaIndex + 1}`,
    );

    let preview;
    if (media.type === 'video') {
        preview = document.createElement('video');
        preview.controls = true;
        preview.preload = 'metadata';
        preview.playsInline = true;
        preview.muted = true;
    } else if (media.type === 'audio') {
        preview = document.createElement('audio');
        preview.controls = true;
        preview.preload = 'metadata';
    } else {
        preview = document.createElement('img');
        preview.loading = 'lazy';
        preview.alt = media.role ? `${media.role} reference` : `Image reference ${mediaIndex + 1}`;
    }

    preview.src = media.url;
    preview.addEventListener('error', () => {
        frame.classList.add('media-error');
        const message = createElement('span', 'media-error-message', 'Preview unavailable');
        frame.append(message);
    }, { once: true });

    const actions = createElement('div', 'media-actions');
    const openLink = createElement('a', 'media-action', 'Open');
    openLink.href = media.url;
    openLink.target = '_blank';
    openLink.rel = 'noreferrer';

    const copyButton = createElement('button', 'media-action', 'Copy URL');
    copyButton.type = 'button';
    copyButton.addEventListener('click', () => copyText(media.url, 'Media URL copied'));

    actions.append(openLink, copyButton);
    frame.append(preview, label, actions);
    figure.append(frame);
    return figure;
}

function buildCaseCard(item) {
    const card = createElement('article', 'case-card');
    card.dataset.caseId = item.id;

    const header = createElement('header', 'card-header');
    const identity = createElement('div', 'card-identity');
    identity.append(
        createElement('span', 'case-index', String(item.index).padStart(2, '0')),
        createElement('h2', '', item.id),
    );

    const chips = createElement('div', 'chips');
    if (item.ratio) chips.append(buildChip(item.ratio));
    if (item.duration !== null && item.duration !== undefined) {
        chips.append(buildChip(`${item.duration}s`));
    }
    if (item.model) chips.append(buildChip(item.model, 'model-chip'));
    header.append(identity, chips);

    const promptSection = createElement('section', 'prompt-section');
    const promptHeading = createElement('div', 'prompt-heading');
    promptHeading.append(createElement('span', 'eyebrow', 'Prompt'));

    const copyPromptButton = createElement('button', 'copy-button', 'Copy');
    copyPromptButton.type = 'button';
    copyPromptButton.addEventListener('click', () => copyText(item.prompt, 'Prompt copied'));
    promptHeading.append(copyPromptButton);

    const prompt = createElement(
        'p',
        `prompt${item.prompt.length > 240 ? ' collapsed' : ''}`,
        item.prompt || 'No text prompt',
    );
    promptSection.append(promptHeading, prompt);

    if (item.prompt.length > 240) {
        const expandButton = createElement('button', 'expand-button', 'Show more');
        expandButton.type = 'button';
        expandButton.addEventListener('click', () => {
            const isCollapsed = prompt.classList.toggle('collapsed');
            expandButton.textContent = isCollapsed ? 'Show more' : 'Show less';
        });
        promptSection.append(expandButton);
    }

    card.append(header, promptSection);

    if (item.media.length) {
        const mediaSection = createElement('section', 'media-section');
        const mediaHeader = createElement('div', 'media-section-header');
        mediaHeader.append(
            createElement('span', 'eyebrow', 'References'),
            createElement('span', 'media-total', `${item.media.length} media`),
        );
        const gallery = createElement('div', `media-gallery count-${Math.min(item.media.length, 4)}`);
        item.media.forEach((media, index) => gallery.append(buildMediaItem(media, index)));
        mediaSection.append(mediaHeader, gallery);
        card.append(mediaSection);
    } else {
        const empty = createElement('section', 'text-only-state');
        const emptyIcon = createElement('span', 'text-only-icon', 'T');
        const copy = createElement('div');
        copy.append(
            createElement('strong', '', 'Text-only case'),
            createElement('span', '', 'This request has no media references.'),
        );
        empty.append(emptyIcon, copy);
        card.append(empty);
    }

    const rawDetails = createElement('details', 'raw-details');
    const rawSummary = createElement('summary');
    rawSummary.append(
        createElement('span', '', 'Raw JSON'),
        createElement('span', 'raw-hint', 'View source'),
    );
    const rawContent = createElement('div', 'raw-content');
    const rawCopyButton = createElement('button', 'copy-button', 'Copy JSON');
    rawCopyButton.type = 'button';
    rawCopyButton.addEventListener('click', () => copyText(item.rawText, 'JSON copied'));
    rawContent.append(rawCopyButton, createElement('pre', '', item.rawText));
    rawDetails.append(rawSummary, rawContent);
    card.append(rawDetails);

    return card;
}

function renderErrors(errors) {
    elements.errorList.replaceChildren();
    elements.errorButton.hidden = errors.length === 0;
    elements.errorPanel.hidden = true;

    if (!errors.length) return;
    elements.errorButton.textContent = `${errors.length} skipped ${errors.length === 1 ? 'line' : 'lines'}`;

    errors.forEach((error) => {
        const item = createElement('li');
        const heading = createElement('strong', '', `Line ${error.line}`);
        const message = createElement('span', '', error.message);
        const source = createElement('code', '', error.source);
        item.append(heading, message, source);
        elements.errorList.append(item);
    });
}

function renderDataset() {
    const dataset = state.dataset;
    if (!dataset) return;

    const visibleItems = filterCases(dataset.items, state.query, state.filter);
    elements.results.replaceChildren(...visibleItems.map(buildCaseCard));
    elements.noResults.hidden = visibleItems.length !== 0;
    elements.resultStatus.textContent =
        `Showing ${visibleItems.length} of ${dataset.items.length} ${dataset.items.length === 1 ? 'case' : 'cases'}`;
}

function updateSummary(dataset) {
    const metadata = dataset.metadata;
    elements.packageName.textContent = metadata?.package_id || 'Untitled package';
    elements.packageEndpoint.textContent = metadata?.endpoint || 'No endpoint metadata';
    elements.packageEndpoint.title = metadata?.endpoint || '';
    elements.caseCount.textContent = dataset.items.length;
    elements.mediaCount.textContent = dataset.mediaCount;
    elements.textOnlyCount.textContent = dataset.textOnlyCount;
}

async function loadText(text, fileName, fileSize, saveRecent = true) {
    const dataset = parseJSONL(text);
    state.dataset = dataset;
    state.fileName = fileName;
    state.fileSize = fileSize;
    state.filter = 'all';
    state.query = '';

    elements.fileName.textContent = fileName;
    elements.fileMeta.textContent = `${formatBytes(fileSize)} · ${dataset.validLineCount} valid lines`;
    elements.searchInput.value = '';
    elements.filterControl.querySelectorAll('button').forEach((button) => {
        const isActive = button.dataset.filter === 'all';
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-pressed', String(isActive));
    });
    elements.workspace.hidden = false;
    elements.dropZone.hidden = true;

    updateSummary(dataset);
    renderErrors(dataset.errors);
    renderDataset();

    if (saveRecent) {
        await saveRecentFile({ name: fileName, text, size: fileSize, openedAt: Date.now() });
        await renderRecentFiles();
    }
}

async function handleFiles(files) {
    const file = files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.jsonl')) {
        showToast('Choose a .jsonl file');
        return;
    }

    try {
        const text = await file.text();
        await loadText(text, file.name, file.size);
    } catch (error) {
        showToast(`Could not read file: ${error.message}`);
    } finally {
        elements.fileInput.value = '';
    }
}

function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onerror = () => reject(request.error);
        request.onupgradeneeded = () => {
            const database = request.result;
            if (!database.objectStoreNames.contains(STORE_NAME)) {
                database.createObjectStore(STORE_NAME, { keyPath: 'name' });
            }
        };
        request.onsuccess = () => resolve(request.result);
    });
}

async function runStore(mode, callback) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, mode);
        const store = transaction.objectStore(STORE_NAME);
        const request = callback(store);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        transaction.oncomplete = () => database.close();
    });
}

async function getRecentFiles() {
    try {
        const files = await runStore('readonly', (store) => store.getAll());
        return files.sort((a, b) => b.openedAt - a.openedAt);
    } catch {
        return [];
    }
}

async function saveRecentFile(file) {
    try {
        await runStore('readwrite', (store) => store.put(file));
        const files = await getRecentFiles();
        await Promise.all(
            files.slice(MAX_RECENT_FILES).map((oldFile) =>
                runStore('readwrite', (store) => store.delete(oldFile.name))),
        );
    } catch {
        // The viewer remains fully usable when browser storage is unavailable.
    }
}

async function renderRecentFiles() {
    const files = await getRecentFiles();
    elements.recentList.replaceChildren();
    elements.recentButton.disabled = files.length === 0;

    if (!files.length) {
        const empty = createElement('p', 'recent-empty', 'Files you open will appear here.');
        elements.recentList.append(empty);
        return;
    }

    files.forEach((file) => {
        const button = createElement('button', 'recent-item');
        button.type = 'button';
        const identity = createElement('span', 'recent-identity');
        identity.append(
            createElement('strong', '', file.name),
            createElement('span', '', `${formatBytes(file.size)} · ${new Date(file.openedAt).toLocaleString()}`),
        );
        button.append(createElement('span', 'file-icon small', 'JL'), identity);
        button.addEventListener('click', async () => {
            await loadText(file.text, file.name, file.size, false);
            setRecentPanel(false);
        });
        elements.recentList.append(button);
    });
}

function setRecentPanel(open) {
    elements.recentPanel.hidden = !open;
    elements.recentButton.setAttribute('aria-expanded', String(open));
    if (open) elements.recentPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function setColumns(columns) {
    const safeColumns = ['1', '2', '3'].includes(String(columns)) ? String(columns) : '2';
    elements.results.className = `results-grid columns-${safeColumns}`;
    elements.layoutControl.querySelectorAll('button').forEach((button) => {
        button.classList.toggle('active', button.dataset.columns === safeColumns);
    });
    localStorage.setItem(LAYOUT_KEY, safeColumns);
}

function chooseFile() {
    elements.fileInput.click();
}

elements.dropZone.addEventListener('click', (event) => {
    if (event.target !== elements.chooseButton) chooseFile();
});
elements.dropZone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        chooseFile();
    }
});
elements.chooseButton.addEventListener('click', (event) => {
    event.stopPropagation();
    chooseFile();
});
elements.replaceButton.addEventListener('click', chooseFile);
elements.fileInput.addEventListener('change', (event) => handleFiles(event.target.files));

['dragenter', 'dragover'].forEach((eventName) => {
    document.addEventListener(eventName, (event) => {
        event.preventDefault();
        elements.dropZone.classList.add('dragover');
    });
});
['dragleave', 'drop'].forEach((eventName) => {
    document.addEventListener(eventName, (event) => {
        event.preventDefault();
        if (eventName === 'drop') handleFiles(event.dataTransfer.files);
        elements.dropZone.classList.remove('dragover');
    });
});

elements.searchInput.addEventListener('input', (event) => {
    state.query = event.target.value;
    renderDataset();
});
elements.searchInput.addEventListener('focus', () => {
    elements.searchShortcut.hidden = true;
});
elements.searchInput.addEventListener('blur', () => {
    elements.searchShortcut.hidden = false;
});
document.addEventListener('keydown', (event) => {
    if (
        event.key === '/' &&
        !event.metaKey &&
        !event.ctrlKey &&
        !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)
    ) {
        event.preventDefault();
        elements.searchInput.focus();
    }
});

elements.filterControl.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-filter]');
    if (!button) return;
    state.filter = button.dataset.filter;
    elements.filterControl.querySelectorAll('button').forEach((candidate) => {
        const isActive = candidate === button;
        candidate.classList.toggle('active', isActive);
        candidate.setAttribute('aria-pressed', String(isActive));
    });
    renderDataset();
});

elements.layoutControl.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-columns]');
    if (button) setColumns(button.dataset.columns);
});

elements.errorButton.addEventListener('click', () => {
    elements.errorPanel.hidden = !elements.errorPanel.hidden;
    if (!elements.errorPanel.hidden) {
        elements.errorPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
});
elements.closeErrorButton.addEventListener('click', () => {
    elements.errorPanel.hidden = true;
});
elements.recentButton.addEventListener('click', () => {
    setRecentPanel(elements.recentPanel.hidden);
});
elements.closeRecentButton.addEventListener('click', () => setRecentPanel(false));

setColumns(localStorage.getItem(LAYOUT_KEY) || '2');
renderRecentFiles();
