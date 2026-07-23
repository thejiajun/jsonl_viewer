const METADATA_KEYS = ['package_id', 'item_count', 'endpoint'];

function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isMetadataEntry(value) {
    if (!isObject(value) || value.request || value.id) return false;
    return METADATA_KEYS.some((key) => key in value);
}

function getContentItems(entry) {
    const content = entry?.request?.content;
    return Array.isArray(content) ? content : [];
}

function extractPrompt(entry) {
    const contentPrompt = getContentItems(entry)
        .filter((content) => content?.type === 'text' && typeof content.text === 'string')
        .map((content) => content.text.trim())
        .filter(Boolean)
        .join('\n\n');
    if (contentPrompt) return contentPrompt;

    const fallbackKeys = ['prompt', 'text', 'gemini_caption', 'caption'];
    const fallbackKey = fallbackKeys.find((key) => typeof entry[key] === 'string' && entry[key].trim());
    return fallbackKey ? entry[fallbackKey].trim() : '';
}

function extractMedia(entry) {
    return getContentItems(entry).flatMap((content) => {
        if (!isObject(content)) return [];

        const candidates = [
            { key: 'image_url', type: 'image' },
            { key: 'video_url', type: 'video' },
            { key: 'audio_url', type: 'audio' },
        ];

        return candidates.flatMap(({ key, type }) => {
            const source = content[key];
            const url = typeof source === 'string' ? source : source?.url;
            if (typeof url !== 'string' || !url.trim()) return [];
            return [{
                type,
                url: url.trim(),
                role: typeof content.role === 'string' ? content.role : '',
            }];
        });
    });
}

function normalizeEntry(entry, index) {
    const request = isObject(entry.request) ? entry.request : {};
    return {
        raw: entry,
        index: index + 1,
        id: String(entry.id || `entry-${String(index + 1).padStart(3, '0')}`),
        model: typeof request.model === 'string' ? request.model : '',
        ratio: typeof request.ratio === 'string' ? request.ratio : '',
        duration: typeof request.duration === 'number' || typeof request.duration === 'string'
            ? request.duration
            : null,
        prompt: extractPrompt(entry),
        media: extractMedia(entry),
        rawText: JSON.stringify(entry, null, 2),
    };
}

export function parseJSONL(text) {
    const errors = [];
    const parsedEntries = [];
    let metadata = null;
    let validLineCount = 0;

    String(text).split(/\r?\n/).forEach((source, zeroBasedLine) => {
        if (!source.trim()) return;
        try {
            const value = JSON.parse(source);
            if (!isObject(value)) {
                errors.push({
                    line: zeroBasedLine + 1,
                    message: 'Expected a JSON object',
                    source: source.length > 180 ? `${source.slice(0, 180)}…` : source,
                });
                return;
            }
            validLineCount += 1;
            if (!metadata && isMetadataEntry(value)) {
                metadata = value;
            } else {
                parsedEntries.push(value);
            }
        } catch (error) {
            errors.push({
                line: zeroBasedLine + 1,
                message: error.message,
                source: source.length > 180 ? `${source.slice(0, 180)}…` : source,
            });
        }
    });

    const items = parsedEntries.map(normalizeEntry);
    const mediaCount = items.reduce((total, item) => total + item.media.length, 0);
    const textOnlyCount = items.filter((item) => item.media.length === 0).length;

    return {
        metadata,
        items,
        errors,
        validLineCount,
        mediaCount,
        textOnlyCount,
    };
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

export function formatBytes(bytes) {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value <= 0) return '0 B';
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
