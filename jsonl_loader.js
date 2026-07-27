import {
    filterCases,
    formatBytes,
    paginateCases,
    parseJSONL,
} from './jsonl_parser.mjs';

const DB_NAME = 'jsonl-viewer';
const STORE_NAME = 'recent-files';
const MAX_RECENT_FILES = 5;
const LAYOUT_KEY = 'jsonl-viewer-columns';
const PAGE_SIZE = 50;
const MEDIA_BATCH_SIZE = 12;
const TEXT_BATCH_SIZE = 12;
const FIELD_BATCH_SIZE = 100;
const SEARCH_DEBOUNCE_MS = 180;
const MAX_RENDERED_ERRORS = 100;
const RAW_PREVIEW_LIMIT = 200_000;
const FIELD_VALUE_PREVIEW_LIMIT = 2_000;
let loadSequence = 0;
let activeParse = null;

const state = {
    dataset: null,
    fileName: '',
    fileSize: 0,
    filter: 'all',
    query: '',
    page: 0,
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
    pagination: document.querySelector('#pagination'),
    previousPageButton: document.querySelector('#previousPageButton'),
    pageIndicator: document.querySelector('#pageIndicator'),
    nextPageButton: document.querySelector('#nextPageButton'),
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

function debounce(callback, delay) {
    let timeout;
    const debounced = (...args) => {
        window.clearTimeout(timeout);
        timeout = window.setTimeout(() => callback(...args), delay);
    };
    debounced.cancel = () => window.clearTimeout(timeout);
    return debounced;
}

function cancelActiveParse() {
    if (!activeParse) return;
    const parse = activeParse;
    activeParse = null;
    parse.worker.terminate();
    parse.reject(new Error('Parsing cancelled'));
}

function parseInWorker(text, formatHint) {
    cancelActiveParse();
    if (!window.Worker) return Promise.resolve(parseJSONL(text, formatHint));

    return new Promise((resolve, reject) => {
        const worker = new Worker(
            new URL('./jsonl_worker.js', import.meta.url),
            { type: 'module' },
        );
        const id = `${Date.now()}-${Math.random()}`;
        activeParse = { reject, worker };

        const finish = () => {
            worker.terminate();
            if (activeParse?.worker === worker) activeParse = null;
        };

        worker.addEventListener('message', (event) => {
            if (event.data.id !== id) return;
            finish();
            if (event.data.error) {
                reject(new Error(event.data.error));
                return;
            }
            resolve(event.data.dataset);
        });
        worker.addEventListener('error', (event) => {
            finish();
            reject(new Error(event.message || 'Background parser failed'));
        }, { once: true });
        worker.postMessage({ id, text, formatHint });
    });
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

function buildTextSection(block, primary = false) {
    const section = createElement(
        'section',
        primary ? 'prompt-section' : 'content-text-section',
    );
    const heading = createElement('div', 'prompt-heading');
    heading.append(createElement('span', 'eyebrow', block.label));

    const copyButton = createElement('button', 'copy-button', 'Copy');
    copyButton.type = 'button';
    copyButton.addEventListener('click', () => copyText(block.text, `${block.label} copied`));
    heading.append(copyButton);

    const content = createElement(
        'p',
        `prompt${block.text.length > 240 ? ' collapsed' : ''}`,
        block.text,
    );
    section.append(heading, content);

    if (block.text.length > 240) {
        const expandButton = createElement('button', 'expand-button', 'Show more');
        expandButton.type = 'button';
        expandButton.addEventListener('click', () => {
            const isCollapsed = content.classList.toggle('collapsed');
            expandButton.textContent = isCollapsed ? 'Show more' : 'Show less';
        });
        section.append(expandButton);
    }

    return section;
}

function appendTextBlocks(card, textBlocks) {
    let renderedCount = 0;
    const loadMoreButton = createElement('button', 'load-more-button text-load-more-button');
    loadMoreButton.type = 'button';

    function renderNextBatch() {
        const end = Math.min(renderedCount + TEXT_BATCH_SIZE, textBlocks.length);
        const fragment = document.createDocumentFragment();
        for (let index = renderedCount; index < end; index += 1) {
            fragment.append(buildTextSection(textBlocks[index]));
        }
        card.insertBefore(fragment, loadMoreButton);
        renderedCount = end;

        const remaining = textBlocks.length - renderedCount;
        loadMoreButton.hidden = remaining === 0;
        loadMoreButton.textContent =
            `Load ${Math.min(TEXT_BATCH_SIZE, remaining)} more text blocks`;
    }

    loadMoreButton.addEventListener('click', renderNextBatch);
    card.append(loadMoreButton);
    renderNextBatch();
}

function buildFieldRow(field) {
    const row = createElement('div', 'field-row');
    const label = createElement('span', 'field-label', field.label);
    label.title = field.path;
    const text = String(field.value);
    const preview = text.length > FIELD_VALUE_PREVIEW_LIMIT
        ? `${text.slice(0, FIELD_VALUE_PREVIEW_LIMIT)}…`
        : text;

    let value;
    if (field.kind === 'link') {
        value = createElement('a', 'field-value field-link', preview);
        value.href = field.value;
        value.target = '_blank';
        value.rel = 'noreferrer';
    } else {
        value = createElement('span', `field-value kind-${field.kind}`, preview);
    }

    row.append(label, value);
    return row;
}

function buildFieldsSection(fields) {
    const section = createElement('section', 'fields-section');
    const heading = createElement('div', 'media-section-header');
    heading.append(
        createElement('span', 'eyebrow', 'Fields'),
        createElement('span', 'media-total', `${fields.length} values`),
    );

    const visibleFields = fields.slice(0, 8);
    const list = createElement('div', 'field-list');
    list.append(...visibleFields.map(buildFieldRow));
    section.append(heading, list);

    if (fields.length > visibleFields.length) {
        const details = createElement('details', 'more-fields');
        const remainingFields = fields.slice(visibleFields.length);
        const summary = createElement(
            'summary',
            '',
            `Show ${remainingFields.length} more`,
        );
        const remainingList = createElement('div', 'field-list');
        const loadMoreButton = createElement('button', 'load-more-button');
        loadMoreButton.type = 'button';
        let renderedCount = 0;

        function renderNextFieldBatch() {
            const end = Math.min(
                renderedCount + FIELD_BATCH_SIZE,
                remainingFields.length,
            );
            const fragment = document.createDocumentFragment();
            for (let index = renderedCount; index < end; index += 1) {
                fragment.append(buildFieldRow(remainingFields[index]));
            }
            remainingList.append(fragment);
            renderedCount = end;

            const remaining = remainingFields.length - renderedCount;
            loadMoreButton.hidden = remaining === 0;
            loadMoreButton.textContent =
                `Load ${Math.min(FIELD_BATCH_SIZE, remaining)} more fields`;
        }

        loadMoreButton.addEventListener('click', renderNextFieldBatch);
        details.append(summary);
        details.addEventListener('toggle', () => {
            if (!details.open || details.dataset.loaded) return;
            renderNextFieldBatch();
            details.append(remainingList, loadMoreButton);
            details.dataset.loaded = 'true';
        });
        section.append(details);
    }

    return section;
}

function buildMediaSection(mediaItems) {
    const mediaSection = createElement('section', 'media-section');
    const mediaHeader = createElement('div', 'media-section-header');
    mediaHeader.append(
        createElement('span', 'eyebrow', 'Media'),
        createElement('span', 'media-total', `${mediaItems.length} media`),
    );
    const gallery = createElement(
        'div',
        `media-gallery count-${Math.min(mediaItems.length, 4)}`,
    );
    let renderedCount = 0;

    const loadMoreButton = createElement('button', 'load-more-button');
    loadMoreButton.type = 'button';

    function renderNextBatch() {
        const end = Math.min(renderedCount + MEDIA_BATCH_SIZE, mediaItems.length);
        const fragment = document.createDocumentFragment();
        for (let index = renderedCount; index < end; index += 1) {
            fragment.append(buildMediaItem(mediaItems[index], index));
        }
        gallery.append(fragment);
        renderedCount = end;

        const remaining = mediaItems.length - renderedCount;
        loadMoreButton.hidden = remaining === 0;
        loadMoreButton.textContent = `Load ${Math.min(MEDIA_BATCH_SIZE, remaining)} more media`;
    }

    loadMoreButton.addEventListener('click', renderNextBatch);
    renderNextBatch();
    mediaSection.append(mediaHeader, gallery, loadMoreButton);
    return mediaSection;
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
    card.append(header);

    if (item.primaryText) card.append(buildTextSection(item.primaryText, true));
    if (item.textBlocks.length) appendTextBlocks(card, item.textBlocks);

    if (item.media.length) {
        card.append(buildMediaSection(item.media));
    } else if (item.primaryText || item.textBlocks.length) {
        const empty = createElement('section', 'text-only-state');
        const emptyIcon = createElement('span', 'text-only-icon', 'T');
        const copy = createElement('div');
        copy.append(
            createElement('strong', '', 'No media attached'),
            createElement('span', '', 'This card contains text or structured fields only.'),
        );
        empty.append(emptyIcon, copy);
        card.append(empty);
    }

    if (item.fields.length) card.append(buildFieldsSection(item.fields));

    const rawDetails = createElement('details', 'raw-details');
    const rawSummary = createElement('summary');
    const isRawPreviewCapped = item.rawText.length > RAW_PREVIEW_LIMIT;
    rawSummary.append(
        createElement('span', '', 'Raw JSON'),
        createElement(
            'span',
            'raw-hint',
            isRawPreviewCapped ? 'Preview capped · copy remains complete' : 'View source',
        ),
    );
    rawDetails.append(rawSummary);
    rawDetails.addEventListener('toggle', () => {
        if (!rawDetails.open || rawDetails.dataset.loaded) return;
        const rawContent = createElement('div', 'raw-content');
        const rawCopyButton = createElement('button', 'copy-button', 'Copy JSON');
        rawCopyButton.type = 'button';
        rawCopyButton.addEventListener('click', () => copyText(item.rawText, 'JSON copied'));
        const preview = isRawPreviewCapped
            ? `${item.rawText.slice(0, RAW_PREVIEW_LIMIT)}\n\n… Preview capped for performance. Copy JSON includes the complete value.`
            : item.rawText;
        rawContent.append(rawCopyButton, createElement('pre', '', preview));
        rawDetails.append(rawContent);
        rawDetails.dataset.loaded = 'true';
    });
    card.append(rawDetails);

    return card;
}

function renderErrors(errors) {
    elements.errorList.replaceChildren();
    elements.errorButton.hidden = errors.length === 0;
    elements.errorPanel.hidden = true;

    if (!errors.length) return;
    elements.errorButton.textContent = `${errors.length} skipped ${errors.length === 1 ? 'line' : 'lines'}`;

    errors.slice(0, MAX_RENDERED_ERRORS).forEach((error) => {
        const item = createElement('li');
        const heading = createElement('strong', '', `Line ${error.line}`);
        const message = createElement('span', '', error.message);
        const source = createElement('code', '', error.source);
        item.append(heading, message, source);
        elements.errorList.append(item);
    });

    if (errors.length > MAX_RENDERED_ERRORS) {
        const remaining = createElement(
            'li',
            'error-overflow',
            `${errors.length - MAX_RENDERED_ERRORS} more skipped lines are not rendered to protect page performance.`,
        );
        elements.errorList.append(remaining);
    }
}

function renderDataset() {
    const dataset = state.dataset;
    if (!dataset) return;

    const visibleItems = filterCases(dataset.items, state.query, state.filter);
    const page = paginateCases(visibleItems, state.page, PAGE_SIZE);
    state.page = page.page;
    elements.results.replaceChildren(...page.items.map(buildCaseCard));
    elements.noResults.hidden = visibleItems.length !== 0;
    elements.pagination.hidden = visibleItems.length === 0 || page.pageCount === 1;
    elements.previousPageButton.disabled = page.page === 0;
    elements.nextPageButton.disabled = page.page === page.pageCount - 1;
    elements.pageIndicator.textContent = `Page ${page.page + 1} of ${page.pageCount}`;

    if (!visibleItems.length) {
        elements.resultStatus.textContent = `0 of ${dataset.items.length} cards match`;
        return;
    }

    const range = page.start + 1 === page.end
        ? `${page.end}`
        : `${page.start + 1}–${page.end}`;
    if (visibleItems.length === dataset.items.length) {
        elements.resultStatus.textContent =
            `Showing ${range} of ${dataset.items.length} ${dataset.items.length === 1 ? 'card' : 'cards'}`;
        return;
    }

    elements.resultStatus.textContent =
        `Showing ${range} of ${visibleItems.length} matching cards (${dataset.items.length} total)`;
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
    const sequence = ++loadSequence;
    const formatHint = fileName.toLocaleLowerCase().endsWith('.jsonl')
        ? 'jsonl'
        : fileName.toLocaleLowerCase().endsWith('.json')
            ? 'json'
            : 'auto';
    showToast('Parsing in the background…');
    let dataset;
    try {
        dataset = await parseInWorker(text, formatHint);
    } catch (error) {
        if (sequence !== loadSequence) return;
        throw error;
    }
    if (sequence !== loadSequence) return;

    updateSearch.cancel();
    state.dataset = dataset;
    state.fileName = fileName;
    state.fileSize = fileSize;
    state.filter = 'all';
    state.query = '';
    state.page = 0;

    elements.fileName.textContent = fileName;
    elements.fileMeta.textContent =
        `${formatBytes(fileSize)} · ${dataset.format.toUpperCase()} · ${dataset.items.length} ${dataset.items.length === 1 ? 'card' : 'cards'}`;
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

    if (!/\.(jsonl|json)$/i.test(file.name)) {
        showToast('Choose a .json or .jsonl file');
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
    updateSearch(event.target.value);
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
    state.page = 0;
    elements.filterControl.querySelectorAll('button').forEach((candidate) => {
        const isActive = candidate === button;
        candidate.classList.toggle('active', isActive);
        candidate.setAttribute('aria-pressed', String(isActive));
    });
    renderDataset();
});

const updateSearch = debounce((query) => {
    state.query = query;
    state.page = 0;
    renderDataset();
}, SEARCH_DEBOUNCE_MS);

function changePage(delta) {
    state.page += delta;
    renderDataset();
    elements.resultStatus.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

elements.previousPageButton.addEventListener('click', () => changePage(-1));
elements.nextPageButton.addEventListener('click', () => changePage(1));

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
