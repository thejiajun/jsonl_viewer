const METADATA_KEYS = ['package_id', 'item_count'];
const IDENTITY_KEYS = ['id', 'name', 'title', 'key'];
const TYPE_KEYS = new Set([
    'type',
    'mime_type',
    'mimeType',
    'content_type',
    'contentType',
    'media_type',
    'mediaType',
]);
const TEXT_TOKENS = new Set([
    'prompt',
    'instruction',
    'instructions',
    'caption',
    'description',
    'script',
    'transcript',
    'message',
    'text',
    'copy',
    'body',
    'content',
]);
const PROMPT_TOKENS = new Set(['prompt', 'instruction', 'instructions']);
const MAX_ANALYZED_VALUES = 2_000;
const MAX_ANALYSIS_DEPTH = 100;
const LINK_LOCATION_TOKENS = new Set(['href', 'link', 'path', 'uri', 'url']);
const AUXILIARY_LINK_TOKENS = new Set([
    'actor',
    'attribution',
    'author',
    'database',
    'documentation',
    'docs',
    'letter',
    'license',
    'licenses',
    'privacy',
    'terms',
]);
const MEDIA_TOKENS = {
    image: new Set([
        'image',
        'images',
        'img',
        'photo',
        'picture',
        'thumbnail',
        'poster',
        'frame',
        'artwork',
        'cover',
    ]),
    video: new Set(['video', 'videos', 'clip', 'movie', 'animation', 'reel']),
    audio: new Set([
        'audio',
        'audios',
        'sound',
        'music',
        'voice',
        'voiceover',
        'soundtrack',
        'speech',
    ]),
};
const MEDIA_SOURCE_TOKENS = new Set([
    'asset',
    'assets',
    'base64',
    'blob',
    'bytes',
    'content',
    'data',
    'file',
    'files',
    'href',
    'path',
    'paths',
    'payload',
    'output',
    'outputs',
    'result',
    'results',
    'source',
    'sources',
    'src',
    'uri',
    'uris',
    'url',
    'urls',
    'value',
]);
const MEDIA_EXTENSIONS = {
    image: new Set(['avif', 'bmp', 'gif', 'heic', 'jpeg', 'jpg', 'png', 'svg', 'webp']),
    video: new Set(['avi', 'm4v', 'mkv', 'mov', 'mp4', 'mpeg', 'mpg', 'webm']),
    audio: new Set(['aac', 'flac', 'm4a', 'mp3', 'oga', 'ogg', 'opus', 'wav']),
};
const NON_MEDIA_EXTENSIONS = new Set([
    'csv',
    'doc',
    'docx',
    'gz',
    'htm',
    'html',
    'json',
    'jsonl',
    'md',
    'pdf',
    'ppt',
    'pptx',
    'tar',
    'txt',
    'xls',
    'xlsx',
    'xml',
    'zip',
]);

function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isMetadataEntry(value) {
    if (!isObject(value) || value.request || value.id) return false;
    return METADATA_KEYS.some((key) => key in value);
}

function isRenderedHeaderField(path, value) {
    if (path.length !== 2 || path[0] !== 'request') return false;
    if (path[1] === 'model' || path[1] === 'ratio') {
        return typeof value === 'string';
    }
    if (path[1] === 'duration') {
        return typeof value === 'number' || typeof value === 'string';
    }
    return false;
}

function tokenize(value) {
    return String(value)
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .toLocaleLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
}

function pathKey(path) {
    return path.map(String).join('.');
}

function formatPath(path) {
    const meaningfulParts = path.filter((part) => part !== 'url');
    if (!meaningfulParts.length) return 'Value';

    return meaningfulParts
        .map((part) => {
            if (typeof part === 'number') return `[${part + 1}]`;
            return String(part)
                .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
                .replace(/[_-]+/g, ' ')
                .replace(/\b\w/g, (character) => character.toUpperCase());
        })
        .join(' › ')
        .replace(/ › \[/g, ' [');
}

function getExplicitType(value, inheritedType = '') {
    if (!isObject(value)) return inheritedType;
    const typeValues = [...TYPE_KEYS]
        .map((key) => value[key])
        .filter((typeValue) => typeof typeValue === 'string' && typeValue.trim())
        .map((typeValue) => typeValue.trim());
    const recognizedMimeType = typeValues.find((typeValue) =>
        typeValue.includes('/') && mediaTypeFromExplicitType(typeValue));
    const recognizedType = typeValues.find((typeValue) =>
        mediaTypeFromExplicitType(typeValue) || isExplicitTextType(typeValue));
    const explicitMimeType = typeValues.find((typeValue) => typeValue.includes('/'));
    return recognizedMimeType || recognizedType || explicitMimeType || inheritedType || typeValues[0] || '';
}

function mediaTypeFromTokens(tokens) {
    const matches = Object.entries(MEDIA_TOKENS)
        .filter(([, candidates]) => tokens.some((token) => candidates.has(token)))
        .map(([type]) => type);
    return matches.length === 1 ? matches[0] : null;
}

function mediaTypeFromExplicitType(explicitType) {
    if (!explicitType) return null;
    const normalized = explicitType.toLocaleLowerCase();
    if (normalized.startsWith('image/')) return 'image';
    if (normalized.startsWith('video/')) return 'video';
    if (normalized.startsWith('audio/')) return 'audio';
    const tokens = tokenize(normalized);
    const transformationIndex = tokens.lastIndexOf('to');
    if (transformationIndex >= 0) {
        return mediaTypeFromTokens(tokens.slice(transformationIndex + 1));
    }
    return mediaTypeFromTokens(tokens);
}

function isExplicitTextType(explicitType) {
    const tokens = tokenize(explicitType);
    return tokens.includes('text') || tokens.includes('prompt') || tokens.includes('caption');
}

function isUrl(value) {
    if (typeof value !== 'string') return false;
    if (
        !/\s/.test(value) &&
        (
            value.startsWith('/') ||
            value.startsWith('./') ||
            value.startsWith('../')
        )
    ) {
        return true;
    }
    try {
        const url = new URL(value);
        return ['http:', 'https:', 'blob:', 'data:'].includes(url.protocol);
    } catch {
        return !/\s/.test(value) && Boolean(mediaTypeFromUrl(value));
    }
}

function mediaTypeFromUrl(value) {
    if (value.startsWith('data:')) {
        const mimeType = value.match(/^data:([^;,]+)/i)?.[1] || '';
        return mediaTypeFromExplicitType(mimeType);
    }

    const extension = fileExtensionFromUrl(value);
    return Object.entries(MEDIA_EXTENSIONS).find(([, extensions]) =>
        extensions.has(extension))?.[0] || null;
}

function fileExtensionFromUrl(value) {
    try {
        const pathname = decodeURIComponent(
            new URL(value, 'https://jsonl-viewer.invalid/').pathname,
        );
        const fileName = pathname.split('/').pop() || '';
        return fileName.includes('.')
            ? fileName.split('.').pop().toLocaleLowerCase()
            : '';
    } catch {
        return '';
    }
}

function mediaTypeFromPath(path) {
    for (let index = path.length - 1; index >= 0; index -= 1) {
        if (typeof path[index] === 'number') continue;
        const tokens = tokenize(path[index]);
        if (tokens.some((token) => AUXILIARY_LINK_TOKENS.has(token))) return null;
        const mediaType = mediaTypeFromTokens(tokens);
        if (mediaType) return mediaType;
        if (!tokens.some((token) => MEDIA_SOURCE_TOKENS.has(token))) return null;
    }
    return null;
}

function canInheritExplicitType(path) {
    const leaf = [...path].reverse().find((part) => typeof part !== 'number');
    return typeof leaf === 'string' &&
        tokenize(leaf).some((token) => MEDIA_SOURCE_TOKENS.has(token));
}

function isContextualRelativeReference(value, path, explicitType) {
    if (
        typeof value !== 'string' ||
        /\s/.test(value)
    ) {
        return false;
    }
    const leaf = [...path].reverse().find((part) => typeof part !== 'number');
    const leafTokens = typeof leaf === 'string' ? tokenize(leaf) : [];
    const linkNamedValue =
        leafTokens.some((token) => LINK_LOCATION_TOKENS.has(token));
    if (!value.includes('/') && !linkNamedValue) return false;
    return (
        linkNamedValue ||
        Boolean(mediaTypeFromPath(path)) ||
        Boolean(mediaTypeFromExplicitType(explicitType))
    );
}

function isReference(value, path, explicitType) {
    return isUrl(value) || isContextualRelativeReference(value, path, explicitType);
}

function shouldPropagateExplicitType(key, explicitType) {
    const tokens = tokenize(key);
    if (mediaTypeFromExplicitType(explicitType)) {
        if (mediaTypeFromTokens(tokens)) return true;
        if (tokens.some((token) => AUXILIARY_LINK_TOKENS.has(token))) return false;
        return tokens.some((token) => MEDIA_SOURCE_TOKENS.has(token));
    }
    return isExplicitTextType(explicitType) &&
        tokens.some((token) =>
            TEXT_TOKENS.has(token) ||
            token === 'content' ||
            token === 'data' ||
            token === 'output' ||
            token === 'outputs' ||
            token === 'result' ||
            token === 'results' ||
            token === 'value');
}

function embeddedMedia(value, path, explicitType) {
    const mediaType = mediaTypeFromExplicitType(explicitType);
    const normalizedType = explicitType.toLocaleLowerCase();
    const leaf = [...path].reverse().find((part) => typeof part !== 'number');
    const leafTokens = typeof leaf === 'string' ? tokenize(leaf) : [];
    if (
        !mediaType ||
        !normalizedType.startsWith(`${mediaType}/`) ||
        !leafTokens.some((token) => token === 'data' || token === 'base64')
    ) {
        return null;
    }
    const looksLikeRawBase64 =
        value.length >= 128 &&
        /^[a-z0-9+/]+={0,2}$/i.test(value);
    const completeMediaReference =
        !looksLikeRawBase64 &&
        isReference(value, path, explicitType);
    if (completeMediaReference) {
        const detectedType = classifyMedia(value, path, explicitType);
        return detectedType ? { type: detectedType, url: value } : null;
    }
    return {
        type: mediaType,
        url: `data:${normalizedType};base64,${value}`,
    };
}

function classifyMedia(value, path, explicitType) {
    if (!isReference(value, path, explicitType)) return null;
    const urlMediaType = mediaTypeFromUrl(value);
    if (urlMediaType) return urlMediaType;
    if (
        value.startsWith('data:') &&
        /^data:[^;,]+/i.test(value)
    ) {
        return null;
    }
    if (NON_MEDIA_EXTENSIONS.has(fileExtensionFromUrl(value))) return null;
    return (
        mediaTypeFromPath(path) ||
        (canInheritExplicitType(path)
            ? mediaTypeFromExplicitType(explicitType)
            : null)
    );
}

function identityForEntry(entry, index) {
    const identityKey = IDENTITY_KEYS.find((key) =>
        ['string', 'number'].includes(typeof entry[key]) && String(entry[key]).trim());
    return {
        key: identityKey || '',
        value: identityKey
            ? String(entry[identityKey])
            : `entry-${String(index + 1).padStart(3, '0')}`,
    };
}

function analyzeEntry(entry, identityKey) {
    const textBlocks = [];
    const media = [];
    const fields = [];
    let analyzedValueCount = 0;
    let analysisTruncated = false;
    let depthTruncated = false;

    function addField(path, value, kind = typeof value) {
        fields.push({
            kind,
            label: formatPath(path),
            path: pathKey(path),
            value,
        });
    }

    function visit(value, path, context = {}) {
        const currentPath = pathKey(path);
        if (path.length > MAX_ANALYSIS_DEPTH) {
            analyzedValueCount += 1;
            analysisTruncated = true;
            depthTruncated = true;
            return;
        }
        if (
            (path.length === 1 && path[0] === identityKey) ||
            isRenderedHeaderField(path, value)
        ) {
            return;
        }

        if (Array.isArray(value)) {
            if (!value.length) {
                analyzedValueCount += 1;
                addField(path, '[]', 'empty');
                return;
            }
            for (let index = 0; index < value.length; index += 1) {
                if (analyzedValueCount >= MAX_ANALYZED_VALUES) {
                    analysisTruncated = true;
                    break;
                }
                visit(value[index], [...path, index], context);
            }
            return;
        }

        if (isObject(value)) {
            const explicitType = getExplicitType(value, context.explicitType);
            const role = typeof value.role === 'string' && value.role.trim()
                ? value.role.trim()
                : context.role || '';
            const recognizedContentObject =
                Boolean(mediaTypeFromExplicitType(explicitType)) ||
                isExplicitTextType(explicitType);
            const entries = Object.entries(value);

            if (!entries.length) {
                analyzedValueCount += 1;
                addField(path, '{}', 'empty');
                return;
            }

            for (const [key, child] of entries) {
                if (
                    recognizedContentObject &&
                    (TYPE_KEYS.has(key) || key === 'role')
                ) {
                    continue;
                }
                if (analyzedValueCount >= MAX_ANALYZED_VALUES) {
                    analysisTruncated = true;
                    break;
                }
                visit(child, [...path, key], {
                    explicitType: shouldPropagateExplicitType(key, explicitType)
                        ? explicitType
                        : '',
                    role,
                });
            }
            return;
        }

        analyzedValueCount += 1;

        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (!trimmed) {
                addField(path, '', 'string');
                return;
            }

            const tokens = path.flatMap(tokenize);
            const leaf = [...path].reverse().find((part) => typeof part !== 'number');
            const leafTokens = typeof leaf === 'string' ? tokenize(leaf) : [];
            const explicitMediaType = mediaTypeFromExplicitType(context.explicitType);
            const explicitText =
                !explicitMediaType && isExplicitTextType(context.explicitType);
            const semanticText = leafTokens.some((token) => TEXT_TOKENS.has(token));
            const semanticSource =
                tokens.some((token) => MEDIA_SOURCE_TOKENS.has(token));
            const semanticMediaType = mediaTypeFromPath(path);
            const reference = isReference(trimmed, path, context.explicitType);
            const linkNamedUrl =
                reference &&
                leafTokens.some((token) => LINK_LOCATION_TOKENS.has(token));
            const prioritizeText =
                explicitText ||
                (
                    semanticText &&
                    !explicitMediaType &&
                    !linkNamedUrl
                );

            if (prioritizeText) {
                const isPrompt =
                    explicitText ||
                    tokens.some((token) => PROMPT_TOKENS.has(token));
                textBlocks.push({
                    isPrompt,
                    label: isPrompt ? 'Prompt' : formatPath(path),
                    path: currentPath,
                    text: trimmed,
                });
                return;
            }

            const embedded = embeddedMedia(
                trimmed,
                path,
                context.explicitType,
            );
            if (embedded) {
                media.push({
                    path: currentPath,
                    role: context.role || formatPath(path),
                    type: embedded.type,
                    url: embedded.url,
                });
                return;
            }

            if (reference) {
                const mediaType = classifyMedia(trimmed, path, context.explicitType);
                if (mediaType) {
                    media.push({
                        path: currentPath,
                        role: context.role || formatPath(path),
                        type: mediaType,
                        url: trimmed,
                    });
                } else {
                    addField(path, trimmed, 'link');
                }
                return;
            }

            const shouldUseTextBlock =
                !explicitMediaType &&
                !semanticSource &&
                trimmed.length >= 160;

            if (shouldUseTextBlock) {
                textBlocks.push({
                    isPrompt: false,
                    label: formatPath(path),
                    path: currentPath,
                    text: trimmed,
                });
            } else {
                addField(path, trimmed, 'string');
            }
            return;
        }

        if (value === null) {
            addField(path, 'null', 'null');
            return;
        }

        addField(path, value, typeof value);
    }

    visit(entry, []);
    if (analysisTruncated) {
        fields.push({
            kind: 'truncated',
            label: 'More values',
            path: '',
            value: `Adaptive rendering is limited to ${MAX_ANALYZED_VALUES.toLocaleString()} values and ${MAX_ANALYSIS_DEPTH} nesting levels. The complete card remains available in Raw JSON.`,
        });
    }
    return { analysisTruncated, depthTruncated, fields, media, textBlocks };
}

function stringifyCompactJSON(value) {
    const chunks = [];
    const stack = [];
    let pending = { value };

    while (pending || stack.length) {
        if (pending) {
            const current = pending.value;
            pending = null;

            if (current === null || typeof current !== 'object') {
                chunks.push(JSON.stringify(current));
                continue;
            }

            const isArray = Array.isArray(current);
            const entries = isArray ? current : Object.entries(current);
            chunks.push(isArray ? '[' : '{');
            if (!entries.length) {
                chunks.push(isArray ? ']' : '}');
                continue;
            }
            stack.push({
                close: isArray ? ']' : '}',
                entries,
                index: 0,
                isArray,
            });
            continue;
        }

        const frame = stack[stack.length - 1];
        if (frame.index >= frame.entries.length) {
            chunks.push(frame.close);
            stack.pop();
            continue;
        }

        if (frame.index > 0) chunks.push(',');
        let child;
        if (frame.isArray) {
            child = frame.entries[frame.index];
        } else {
            const [key, value] = frame.entries[frame.index];
            chunks.push(JSON.stringify(key), ':');
            child = value;
        }
        frame.index += 1;
        pending = { value: child };
    }

    return chunks.join('');
}

function normalizeEntry(source, index) {
    const { entry, rawValue } = source;
    const request = isObject(entry.request) ? entry.request : {};
    const identity = identityForEntry(entry, index);
    const analysis = analyzeEntry(entry, identity.key);
    const primaryText =
        analysis.textBlocks.find((block) => block.isPrompt) ||
        analysis.textBlocks[0] ||
        null;

    return {
        index: index + 1,
        id: identity.value,
        model: typeof request.model === 'string' ? request.model : '',
        ratio: typeof request.ratio === 'string' ? request.ratio : '',
        duration: typeof request.duration === 'number' || typeof request.duration === 'string'
            ? request.duration
            : null,
        prompt: primaryText?.text || '',
        primaryText,
        textBlocks: analysis.textBlocks.filter((block) => block !== primaryText),
        media: analysis.media,
        fields: analysis.fields,
        rawText: analysis.analysisTruncated
            ? stringifyCompactJSON(rawValue)
            : JSON.stringify(rawValue, null, 2),
    };
}

function buildDataset(entries, metadata, errors, validLineCount, format) {
    const items = entries.map(normalizeEntry);
    const mediaCount = items.reduce((total, item) => total + item.media.length, 0);
    const textOnlyCount = items.filter((item) => item.media.length === 0).length;

    return {
        metadata,
        items,
        errors,
        validLineCount,
        mediaCount,
        textOnlyCount,
        format,
    };
}

function prepareEntry(value) {
    return {
        entry: isObject(value) ? value : { value },
        rawValue: value,
    };
}

function tryParseJSON(text) {
    try {
        const value = JSON.parse(text);
        const entries = (Array.isArray(value) ? value : [value]).map(prepareEntry);
        return buildDataset(entries, null, [], entries.length, 'json');
    } catch {
        return null;
    }
}

function parseJSONLines(text) {
    const errors = [];
    const entries = [];
    let metadata = null;
    let validLineCount = 0;

    text.split(/\r?\n/).forEach((source, zeroBasedLine) => {
        if (!source.trim()) return;
        try {
            const value = JSON.parse(source);
            validLineCount += 1;
            if (!metadata && isObject(value) && isMetadataEntry(value)) {
                metadata = value;
            } else {
                entries.push(prepareEntry(value));
            }
        } catch (error) {
            errors.push({
                line: zeroBasedLine + 1,
                message: error.message,
                source: source.length > 180 ? `${source.slice(0, 180)}…` : source,
            });
        }
    });

    return buildDataset(entries, metadata, errors, validLineCount, 'jsonl');
}

export function parseJSONL(text, formatHint = 'auto') {
    const source = String(text);
    if (!source.trim()) return buildDataset([], null, [], 0, 'jsonl');
    if (formatHint === 'jsonl') return parseJSONLines(source);
    if (formatHint === 'json') return tryParseJSON(source) || parseJSONLines(source);
    return tryParseJSON(source) || parseJSONLines(source);
}

export function filterCases(items, query = '', filter = 'all') {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return items.filter((item) => {
        const matchesFilter =
            filter === 'all' ||
            (filter === 'media' && item.media.length > 0) ||
            (filter === 'text' && item.media.length === 0);
        if (!matchesFilter) return false;
        if (!normalizedQuery) return true;
        return [
            item.id,
            item.prompt,
            item.model,
            item.ratio,
            String(item.duration ?? ''),
            item.rawText,
        ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
    });
}

export function paginateCases(items, page = 0, pageSize = 50) {
    const safePageSize = Math.max(1, Math.floor(Number(pageSize)) || 50);
    const pageCount = Math.max(1, Math.ceil(items.length / safePageSize));
    const safePage = Math.min(
        Math.max(0, Math.floor(Number(page)) || 0),
        pageCount - 1,
    );
    const start = safePage * safePageSize;
    const end = Math.min(start + safePageSize, items.length);

    return {
        items: items.slice(start, end),
        page: safePage,
        pageCount,
        pageSize: safePageSize,
        start,
        end,
        total: items.length,
    };
}

export function formatBytes(bytes) {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value <= 0) return '0 B';
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
