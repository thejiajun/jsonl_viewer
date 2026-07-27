import assert from 'node:assert/strict';
import test from 'node:test';

import {
    filterCases,
    formatBytes,
    paginateCases,
    parseJSONL,
} from '../jsonl_parser.mjs';

const fixture = [
    JSON.stringify({
        package_id: 'media-review',
        item_count: 2,
        endpoint: '/v1/videos',
    }),
    JSON.stringify({
        id: 'case-001',
        request: {
            model: 'target-video-model',
            ratio: '16:9',
            duration: 5,
            content: [
                { type: 'text', text: 'A blue car drives past the camera.' },
                {
                    type: 'image_url',
                    role: 'first_frame',
                    image_url: { url: 'https://cdn.example.com/frame.jpg' },
                },
                {
                    type: 'video_url',
                    role: 'reference',
                    video_url: { url: 'https://cdn.example.com/reference.mp4' },
                },
            ],
        },
    }),
    JSON.stringify({
        id: 'case-002',
        request: {
            content: [{ type: 'text', text: 'A text-only request.' }],
        },
    }),
    '{"id": "broken"',
    '[1, 2',
].join('\n');

test('parses package metadata, cases, media, and invalid lines', () => {
    const dataset = parseJSONL(fixture);

    assert.equal(dataset.format, 'jsonl');
    assert.equal(dataset.metadata.package_id, 'media-review');
    assert.equal(dataset.items.length, 2);
    assert.equal(dataset.mediaCount, 2);
    assert.equal(dataset.textOnlyCount, 1);
    assert.equal(dataset.errors.length, 2);
    assert.equal(dataset.errors[0].line, 4);
    assert.equal(dataset.errors[1].line, 5);
    assert.equal(dataset.errors[1].source, '[1, 2');
    assert.equal(dataset.items[0].prompt, 'A blue car drives past the camera.');
    assert.deepEqual(
        dataset.items[0].media.map(({ type, role }) => ({ type, role })),
        [
            { type: 'image', role: 'first_frame' },
            { type: 'video', role: 'reference' },
        ],
    );
});

test('parses a formatted JSON object as one card', () => {
    const dataset = parseJSONL(JSON.stringify({
        id: 'json-object-card',
        prompt: 'This object spans multiple formatted JSON lines.',
        image: 'https://assets.example.com/photo.png',
    }, null, 2));

    assert.equal(dataset.format, 'json');
    assert.equal(dataset.items.length, 1);
    assert.equal(dataset.items[0].id, 'json-object-card');
    assert.equal(dataset.items[0].media[0].type, 'image');
    assert.equal(dataset.errors.length, 0);
});

test('parses every element in a JSON array as a card', () => {
    const dataset = parseJSONL(JSON.stringify([
        { id: 'array-card-1', score: 0.8 },
        { id: 'array-card-2', approved: true },
        'plain string card',
        42,
    ]));

    assert.equal(dataset.format, 'json');
    assert.equal(dataset.items.length, 4);
    assert.deepEqual(
        dataset.items.map((item) => item.id),
        ['array-card-1', 'array-card-2', 'entry-003', 'entry-004'],
    );
    assert.equal(dataset.items[2].fields[0].value, 'plain string card');
    assert.equal(dataset.items[3].fields[0].value, 42);
});

test('keeps endpoint-like objects in JSON arrays as content cards', () => {
    const dataset = parseJSONL(JSON.stringify([
        { endpoint: '/health', status: 'ok' },
        { id: 'second-card' },
    ]));

    assert.equal(dataset.metadata, null);
    assert.equal(dataset.items.length, 2);
    assert.equal(dataset.items[0].fields.find(({ path }) => path === 'endpoint')?.value, '/health');
});

test('keeps endpoint-only JSONL objects as content cards', () => {
    const dataset = parseJSONL(
        '{"endpoint":"/health","status":"ok"}',
        'jsonl',
    );

    assert.equal(dataset.metadata, null);
    assert.equal(dataset.items.length, 1);
    assert.equal(
        dataset.items[0].fields.find(({ path }) => path === 'endpoint')?.value,
        '/health',
    );
});

test('normalizes primitive and array values in JSONL as cards', () => {
    const dataset = parseJSONL([
        '"first"',
        '42',
        'true',
        'null',
        '["a", "b"]',
    ].join('\n'), 'jsonl');

    assert.equal(dataset.items.length, 5);
    assert.equal(dataset.errors.length, 0);
    assert.deepEqual(
        dataset.items.slice(0, 4).map((item) => item.fields[0].value),
        ['first', 42, true, 'null'],
    );
    assert.deepEqual(
        dataset.items[4].fields.map(({ value }) => value),
        ['a', 'b'],
    );
    assert.equal(dataset.items[0].rawText, '"first"');
    assert.equal(dataset.items[1].rawText, '42');
    assert.equal(dataset.items[4].rawText, '[\n  "a",\n  "b"\n]');
});

test('preserves leading blank lines when reporting JSONL errors', () => {
    const dataset = parseJSONL('\n\n{"id":"ok"}\nnot-json');

    assert.equal(dataset.items.length, 1);
    assert.equal(dataset.errors[0].line, 4);
});

test('filters by media presence and searchable fields', () => {
    const { items } = parseJSONL(fixture);

    assert.deepEqual(filterCases(items, '', 'media').map((item) => item.id), ['case-001']);
    assert.deepEqual(filterCases(items, '', 'text').map((item) => item.id), ['case-002']);
    assert.deepEqual(filterCases(items, 'BLUE CAR', 'all').map((item) => item.id), ['case-001']);
    assert.deepEqual(filterCases(items, 'case-002', 'all').map((item) => item.id), ['case-002']);
    assert.equal(filterCases(items, 'missing', 'all').length, 0);
});

test('keeps generic JSONL useful with fallback text and raw-field search', () => {
    const dataset = parseJSONL(JSON.stringify({
        gemini_caption: 'A fallback caption.',
        custom_review_state: 'needs-legal-review',
    }));

    assert.equal(dataset.items[0].prompt, 'A fallback caption.');
    assert.deepEqual(
        filterCases(dataset.items, 'needs-legal-review', 'all').map((item) => item.id),
        ['entry-001'],
    );
});

test('renders arbitrary cards and infers media without relying on a CDN hostname', () => {
    const dataset = parseJSONL(JSON.stringify({
        name: 'mixed-content-card',
        instruction: 'Turn this collection of fields into one useful content card.',
        hero_asset: 'https://assets.example.org/render.webp?signature=123',
        output: {
            clip: 'https://media.other-host.net/final.MP4',
            soundtrack_url: 'https://files.example.com/audio?id=42',
        },
        attachment: {
            content_type: 'audio/mpeg',
            url: 'https://storage.example.net/object-without-extension',
        },
        documentation: 'https://example.com/guide',
        score: 0.93,
        flags: [true, false],
    }));

    const [item] = dataset.items;
    assert.equal(item.id, 'mixed-content-card');
    assert.equal(item.primaryText.label, 'Prompt');
    assert.deepEqual(item.media.map(({ type }) => type), ['image', 'video', 'audio', 'audio']);
    assert.equal(item.media.some(({ url }) => url.includes('cdn.')), false);
    assert.equal(
        item.fields.find(({ path }) => path === 'documentation')?.kind,
        'link',
    );
    assert.equal(
        item.fields.find(({ path }) => path === 'score')?.value,
        0.93,
    );
    assert.deepEqual(
        item.fields.filter(({ path }) => path.startsWith('flags.')).map(({ value }) => value),
        [true, false],
    );
});

test('leaves unknown extensionless URLs as links instead of fetching to guess', () => {
    const dataset = parseJSONL(JSON.stringify({
        id: 'unknown-url',
        resource_url: 'https://files.example.com/object?id=123',
    }));
    const [item] = dataset.items;

    assert.equal(item.media.length, 0);
    assert.equal(item.fields[0].kind, 'link');
});

test('keeps extensionless auxiliary media-word URLs as links', () => {
    const urls = {
        cover_letter_url: 'https://example.com/cover-letter',
        movie_database_url: 'https://example.com/movie-database',
        music_license_url: 'https://example.com/music-license',
        voice_actor_url: 'https://example.com/voice-actor',
        frame_documentation_url: 'https://example.com/frame-documentation',
    };
    const dataset = parseJSONL(JSON.stringify({
        id: 'auxiliary-media-word-links',
        ...urls,
    }));
    const [item] = dataset.items;

    assert.equal(item.media.length, 0);
    assert.deepEqual(
        item.fields.filter(({ kind }) => kind === 'link').map(({ path }) => path),
        Object.keys(urls),
    );
});

test('keeps URLs with known non-media extensions as links', () => {
    const dataset = parseJSONL(JSON.stringify({
        id: 'cover-letter',
        cover_letter_url: 'https://example.com/resume.pdf',
    }));
    const [item] = dataset.items;

    assert.equal(item.media.length, 0);
    assert.deepEqual(
        item.fields.map(({ path, kind }) => ({ path, kind })),
        [{ path: 'cover_letter_url', kind: 'link' }],
    );
});

test('infers media from semantic fields and MIME types with unknown extensions', () => {
    const dataset = parseJSONL(JSON.stringify({
        id: 'unknown-media-extensions',
        image_url: 'https://assets.example.com/render.bin',
        asset: {
            mime_type: 'video/mp4',
            url: 'https://assets.example.com/download.php',
        },
    }));

    assert.deepEqual(
        dataset.items[0].media.map(({ type }) => type),
        ['image', 'video'],
    );
});

test('uses child URL evidence before an inherited container media type', () => {
    const dataset = parseJSONL(JSON.stringify({
        id: 'video-with-poster',
        media: {
            type: 'video',
            url: 'https://assets.example.com/main.mp4',
            poster: 'https://assets.example.com/poster.jpg',
        },
    }));

    assert.deepEqual(
        dataset.items[0].media.map(({ type }) => type),
        ['video', 'image'],
    );
});

test('keeps non-media links inside media objects as regular fields', () => {
    const dataset = parseJSONL(JSON.stringify({
        id: 'image-with-documentation',
        asset: {
            type: 'image',
            url: 'https://assets.example.com/signed-image?id=1',
            documentation: 'https://example.com/image-guide',
            license: 'https://example.com/license',
            documentation_url: 'https://example.com/image-docs',
            license_url: 'https://example.com/image-license',
            author: {
                url: 'https://example.com/creator',
            },
        },
    }));
    const [item] = dataset.items;

    assert.deepEqual(
        item.media.map(({ type, url }) => ({ type, url })),
        [{
            type: 'image',
            url: 'https://assets.example.com/signed-image?id=1',
        }],
    );
    assert.deepEqual(
        item.fields.filter(({ kind }) => kind === 'link').map(({ path }) => path),
        [
            'asset.documentation',
            'asset.license',
            'asset.documentation_url',
            'asset.license_url',
            'asset.author.url',
        ],
    );
});

test('recognizes plural media fields with signed URLs', () => {
    const dataset = parseJSONL(JSON.stringify({
        id: 'plural-media-fields',
        images: ['https://assets.example.com/signed-image?id=1'],
        videos: ['https://assets.example.com/signed-video?id=2'],
        audios: ['https://assets.example.com/signed-audio?id=3'],
    }));

    assert.deepEqual(
        dataset.items[0].media.map(({ type }) => type),
        ['image', 'video', 'audio'],
    );
});

test('propagates explicit media types through plural source wrappers', () => {
    const dataset = parseJSONL(JSON.stringify({
        id: 'plural-source-wrappers',
        asset: {
            type: 'image',
            urls: ['https://assets.example.com/signed?id=1'],
            sources: ['https://assets.example.com/signed?id=2'],
            files: ['https://assets.example.com/signed?id=3'],
        },
    }));

    assert.deepEqual(
        dataset.items[0].media.map(({ type }) => type),
        ['image', 'image', 'image'],
    );
});

test('uses a recognized MIME type before a generic container type', () => {
    const dataset = parseJSONL(JSON.stringify({
        id: 'signed-image',
        asset: {
            type: 'file',
            mime_type: 'image/png',
            url: 'https://assets.example.com/signed-object?id=1',
        },
    }));

    assert.deepEqual(
        dataset.items[0].media.map(({ type, url }) => ({ type, url })),
        [{
            type: 'image',
            url: 'https://assets.example.com/signed-object?id=1',
        }],
    );
});

test('uses complete embedded URLs as stronger media evidence than the parent MIME type', () => {
    const dataset = parseJSONL(JSON.stringify([
        {
            id: 'video-in-image-data',
            asset: {
                mime_type: 'image/png',
                data: 'https://assets.example.com/final.mp4',
            },
        },
        {
            id: 'audio-data-url-in-image-data',
            asset: {
                mime_type: 'image/png',
                data: 'data:audio/wav;base64,AAAA',
            },
        },
        {
            id: 'document-in-image-data',
            asset: {
                mime_type: 'image/png',
                data: 'https://assets.example.com/document.pdf',
            },
        },
    ]));

    assert.deepEqual(
        dataset.items.map((item) => item.media.map(({ type }) => type)),
        [['video'], ['audio'], []],
    );
    assert.equal(
        dataset.items[2].fields.find(({ path }) => path === 'asset.data')?.kind,
        'link',
    );
});

test('explicit non-media MIME types block inherited media types', () => {
    const dataset = parseJSONL(JSON.stringify({
        id: 'document-in-image-container',
        asset: {
            type: 'image',
            source: {
                mime_type: 'application/pdf',
                url: 'https://assets.example.com/signed-document?id=1',
            },
        },
    }));
    const [item] = dataset.items;

    assert.equal(item.media.length, 0);
    assert.equal(
        item.fields.find(({ path }) => path === 'asset.source.url')?.kind,
        'link',
    );
});

test('preserves separate media roles that use the same URL', () => {
    const sharedUrl = 'https://assets.example.com/shared-frame.jpg';
    const dataset = parseJSONL(JSON.stringify({
        id: 'shared-frame-roles',
        request: {
            content: [
                {
                    type: 'image_url',
                    role: 'first_frame',
                    image_url: { url: sharedUrl },
                },
                {
                    type: 'image_url',
                    role: 'last_frame',
                    image_url: { url: sharedUrl },
                },
            ],
        },
    }));

    assert.deepEqual(
        dataset.items[0].media.map(({ role, url }) => ({ role, url })),
        [
            { role: 'first_frame', url: sharedUrl },
            { role: 'last_frame', url: sharedUrl },
        ],
    );
});

test('preserves media from flat keys that collide with nested display paths', () => {
    const dataset = parseJSONL(JSON.stringify({
        id: 'colliding-paths',
        'media.image': 'https://assets.example.com/flat.jpg',
        media: {
            image: 'https://assets.example.com/nested.jpg',
        },
    }));

    assert.deepEqual(
        dataset.items[0].media.map(({ url }) => url),
        [
            'https://assets.example.com/flat.jpg',
            'https://assets.example.com/nested.jpg',
        ],
    );
});

test('supports relative media references from semantic fields', () => {
    const dataset = parseJSONL(JSON.stringify({
        id: 'relative-media',
        image_url: './assets/reference.jpg',
        video_url: '/assets/reference.mp4',
        thumbnail: 'assets/thumbnail.webp',
        audio_url: 'audio/reference.mp3',
        signed_image_url: 'assets/render?id=1',
        local_image_url: 'render?id=2',
    }));

    assert.deepEqual(
        dataset.items[0].media.map(({ type, url }) => ({ type, url })),
        [
            { type: 'image', url: './assets/reference.jpg' },
            { type: 'video', url: '/assets/reference.mp4' },
            { type: 'image', url: 'assets/thumbnail.webp' },
            { type: 'audio', url: 'audio/reference.mp3' },
            { type: 'image', url: 'assets/render?id=1' },
            { type: 'image', url: 'render?id=2' },
        ],
    );
});

test('keeps ordinary relative paths clickable in URL fields', () => {
    const dataset = parseJSONL(JSON.stringify({
        id: 'relative-links',
        documentation_url: 'docs/guide.pdf',
        resource_url: 'assets/download?id=1',
        local_resource_url: 'guide.pdf',
        category: 'products/featured',
    }));
    const [item] = dataset.items;

    assert.deepEqual(
        item.fields.map(({ path, kind }) => ({ path, kind })),
        [
            { path: 'documentation_url', kind: 'link' },
            { path: 'resource_url', kind: 'link' },
            { path: 'local_resource_url', kind: 'link' },
            { path: 'category', kind: 'string' },
        ],
    );
});

test('uses the output type for explicit media transformations', () => {
    const dataset = parseJSONL(JSON.stringify({
        id: 'image-to-video-result',
        result: {
            type: 'image-to-video',
            url: 'https://assets.example.com/signed-object?id=1',
        },
    }));

    assert.equal(dataset.items[0].media[0].type, 'video');
});

test('keeps non-media transformation outputs as regular links', () => {
    for (const type of ['speech-to-text', 'image-to-text', 'video-to-3d']) {
        const dataset = parseJSONL(JSON.stringify({
            id: type,
            result: {
                type,
                url: 'https://assets.example.com/signed?id=1',
            },
        }));
        const [item] = dataset.items;

        assert.equal(item.media.length, 0);
        assert.equal(
            item.fields.find(({ path }) => path === 'result.url')?.kind,
            'link',
        );
    }
});

test('propagates text-to-media output types to signed URLs', () => {
    const dataset = parseJSONL(JSON.stringify({
        id: 'transformation-outputs',
        outputs: [
            {
                type: 'text-to-image',
                url: 'https://assets.example.com/signed-image?id=1',
            },
            {
                type: 'text-to-video',
                url: 'https://assets.example.com/signed-video?id=2',
            },
            {
                type: 'text-to-speech',
                url: 'https://assets.example.com/signed-audio?id=3',
            },
        ],
    }));

    assert.deepEqual(
        dataset.items[0].media.map(({ type }) => type),
        ['image', 'video', 'audio'],
    );
});

test('propagates explicit media types through result wrappers', () => {
    const dataset = parseJSONL(JSON.stringify([
        {
            id: 'wrapped-video-output',
            type: 'text-to-video',
            output: {
                url: 'https://assets.example.com/signed-video?id=1',
            },
        },
        {
            id: 'wrapped-image-result',
            type: 'text-to-image',
            result: {
                url: 'https://assets.example.com/signed-image?id=2',
            },
        },
    ]));

    assert.deepEqual(
        dataset.items.map((item) => item.media.map(({ type }) => type)),
        [['video'], ['image']],
    );
});

test('propagates explicit text types through result wrappers', () => {
    const dataset = parseJSONL(JSON.stringify([
        {
            id: 'wrapped-text-output',
            type: 'image-to-text',
            output: 'A short generated caption.',
        },
        {
            id: 'wrapped-text-result',
            type: 'speech-to-text',
            result: 'A short transcript.',
        },
    ]));

    assert.deepEqual(
        dataset.items.map((item) => item.primaryText?.text),
        ['A short generated caption.', 'A short transcript.'],
    );
    assert.deepEqual(
        dataset.items.map((item) => item.fields.length),
        [0, 0],
    );
});

test('preserves inherited media types through transport wrappers', () => {
    const dataset = parseJSONL(JSON.stringify({
        id: 'nested-media-source',
        media: {
            type: 'image',
            source: {
                type: 'url',
                url: 'https://assets.example.com/signed-image?id=1',
            },
        },
        thumbnail: {
            type: 'image',
            payload: {
                url: 'https://assets.example.com/signed-thumbnail?id=2',
            },
        },
    }));

    assert.deepEqual(
        dataset.items[0].media.map(({ type }) => type),
        ['image', 'image'],
    );
});

test('keeps explicit text URLs and slash commands in text containers', () => {
    const dataset = parseJSONL(JSON.stringify({
        id: 'url-shaped-prompts',
        request: {
            content: [{
                type: 'text',
                text: 'https://example.com/reference',
            }],
        },
        prompt: '/imagine prompt: a cinematic cat',
    }));

    assert.deepEqual(
        [dataset.items[0].primaryText, ...dataset.items[0].textBlocks]
            .map(({ text }) => text),
        [
            'https://example.com/reference',
            '/imagine prompt: a cinematic cat',
        ],
    );
});

test('keeps slash commands in semantic prompt fields', () => {
    const dataset = parseJSONL(JSON.stringify({
        id: 'slash-command',
        prompt: '/help',
    }));

    assert.equal(dataset.items[0].primaryText.text, '/help');
    assert.equal(dataset.items[0].fields.length, 0);
});

test('prioritizes semantic text fields that also contain media tokens', () => {
    const dataset = parseJSONL(JSON.stringify({
        id: 'media-text-fields',
        video_prompt: 'A cinematic orbit around the subject.',
        image_caption: 'A portrait at golden hour.',
        audio_transcript: 'Welcome to the show.',
    }));
    const [item] = dataset.items;

    assert.deepEqual(
        [item.primaryText, ...item.textBlocks].map(({ path, text }) => ({ path, text })),
        [
            {
                path: 'video_prompt',
                text: 'A cinematic orbit around the subject.',
            },
            {
                path: 'image_caption',
                text: 'A portrait at golden hour.',
            },
            {
                path: 'audio_transcript',
                text: 'Welcome to the show.',
            },
        ],
    );
    assert.equal(item.fields.length, 0);
});

test('keeps untyped URL fields clickable even when their names contain text tokens', () => {
    const dataset = parseJSONL(JSON.stringify({
        id: 'text-token-links',
        content_url: 'https://example.com/content',
        description_url: 'https://example.com/description',
    }));

    assert.deepEqual(
        dataset.items[0].fields.map(({ path, kind }) => ({ path, kind })),
        [
            { path: 'content_url', kind: 'link' },
            { path: 'description_url', kind: 'link' },
        ],
    );
    assert.equal(dataset.items[0].primaryText, null);
});

test('propagates explicit text types through generic content fields', () => {
    const dataset = parseJSONL(JSON.stringify({
        id: 'typed-text-content',
        block: {
            type: 'text',
            content: 'Content stored under a generic field.',
        },
    }));

    assert.equal(
        dataset.items[0].primaryText.text,
        'Content stored under a generic field.',
    );
});

test('renders untyped message content as text instead of a generic field', () => {
    const dataset = parseJSONL(JSON.stringify({
        id: 'message-content',
        message: {
            role: 'assistant',
            content: 'A normal untyped chat message.',
        },
    }));
    const [item] = dataset.items;

    assert.equal(item.primaryText.text, 'A normal untyped chat message.');
    assert.equal(item.primaryText.label, 'Message › Content');
    assert.deepEqual(
        item.fields.map(({ path, value }) => ({ path, value })),
        [{ path: 'message.role', value: 'assistant' }],
    );
});

test('renders a generic content field as text', () => {
    const content = 'A'.repeat(500);
    const dataset = parseJSONL(JSON.stringify({
        id: 'generic-content',
        content,
    }));
    const [item] = dataset.items;

    assert.equal(item.primaryText.text, content);
    assert.equal(item.fields.length, 0);
});

test('renders embedded base64 media without treating payloads as text', () => {
    const payloads = [
        'a'.repeat(4_000),
        `/9j/${'a'.repeat(4_000)}`,
    ];
    for (const field of ['data', 'base64']) {
        for (const payload of payloads) {
            const dataset = parseJSONL(JSON.stringify({
                id: `embedded-image-${field}`,
                source: {
                    media_type: 'image/jpeg',
                    [field]: payload,
                },
            }));
            const [item] = dataset.items;

            assert.equal(item.media.length, 1);
            assert.equal(item.media[0].type, 'image');
            assert.equal(item.media[0].url, `data:image/jpeg;base64,${payload}`);
            assert.equal(item.primaryText, null);
            assert.equal(item.textBlocks.length, 0);
            assert.equal(item.fields.length, 0);
        }
    }
});

test('keeps untyped source payloads out of full text rendering', () => {
    const payload = 'a'.repeat(1_000_000);
    const dataset = parseJSONL(JSON.stringify({
        id: 'untyped-payload',
        image_base64: payload,
        transport: {
            payload,
        },
    }));
    const [item] = dataset.items;

    assert.equal(item.primaryText, null);
    assert.equal(item.textBlocks.length, 0);
    assert.deepEqual(
        item.fields.map(({ path, value }) => ({ path, value })),
        [
            { path: 'image_base64', value: payload },
            { path: 'transport.payload', value: payload },
        ],
    );
});

test('preserves complete media URLs stored under embedded-data fields', () => {
    for (const url of [
        'data:image/png;base64,AAAA',
        'https://assets.example.com/image.png',
        '/api/assets/signed?id=1',
        '//cdn.example.com/signed?id=2',
        'assets/signed?id=3',
    ]) {
        const dataset = parseJSONL(JSON.stringify({
            source: {
                media_type: 'image/png',
                data: url,
            },
        }));

        assert.equal(dataset.items[0].media.length, 1);
        assert.equal(dataset.items[0].media[0].type, 'image');
        assert.equal(dataset.items[0].media[0].url, url);
    }
});

test('uses the file format hint to preserve single-line JSONL metadata', () => {
    const dataset = parseJSONL(
        '{"package_id":"metadata-only","item_count":0}',
        'jsonl',
    );

    assert.equal(dataset.metadata.package_id, 'metadata-only');
    assert.equal(dataset.items.length, 0);
    assert.equal(dataset.format, 'jsonl');
});

test('keeps unsupported header value types visible as generic fields', () => {
    const dataset = parseJSONL(JSON.stringify({
        id: 'nonstandard-headers',
        request: {
            model: 42,
            ratio: null,
            duration: false,
        },
    }));

    assert.deepEqual(
        dataset.items[0].fields.map(({ path, value }) => ({ path, value })),
        [
            { path: 'request.model', value: 42 },
            { path: 'request.ratio', value: 'null' },
            { path: 'request.duration', value: false },
        ],
    );
});

test('keeps flattened request header keys visible as generic fields', () => {
    const dataset = parseJSONL(JSON.stringify({
        id: 'flat-request-headers',
        'request.model': 'flat-model',
        'request.ratio': '16:9',
        'request.duration': 5,
    }));

    assert.deepEqual(
        dataset.items[0].fields.map(({ label, value }) => ({ label, value })),
        [
            { label: 'Request.Model', value: 'flat-model' },
            { label: 'Request.Ratio', value: '16:9' },
            { label: 'Request.Duration', value: 5 },
        ],
    );
});

test('formats file sizes for the UI', () => {
    assert.equal(formatBytes(0), '0 B');
    assert.equal(formatBytes(512), '512 B');
    assert.equal(formatBytes(2048), '2.0 KB');
    assert.equal(formatBytes(2 * 1024 * 1024), '2.0 MB');
});

test('parses and pages 10,000 cards without creating an oversized render window', () => {
    const source = Array.from({ length: 10_000 }, (_, index) => JSON.stringify({
        id: `large-card-${index + 1}`,
        prompt: `Prompt ${index + 1}`,
        score: index / 10_000,
    })).join('\n');

    const dataset = parseJSONL(source);
    const firstPage = paginateCases(dataset.items, 0, 50);
    const lastPage = paginateCases(dataset.items, 999, 50);

    assert.equal(dataset.items.length, 10_000);
    assert.equal(dataset.errors.length, 0);
    assert.equal(firstPage.items.length, 50);
    assert.equal(firstPage.pageCount, 200);
    assert.equal(firstPage.items[0].id, 'large-card-1');
    assert.equal(lastPage.page, 199);
    assert.equal(lastPage.items.length, 50);
    assert.equal(lastPage.items[49].id, 'large-card-10000');
});

test('caps specialized analysis for very large nested arrays', () => {
    const dataset = parseJSONL(JSON.stringify({
        id: 'large-array',
        values: Array.from({ length: 10_000 }, (_, index) => index),
    }));
    const [item] = dataset.items;

    assert.equal(item.fields.length, 2_001);
    assert.equal(item.fields[0].path, 'values.0');
    assert.equal(item.fields[1_999].path, 'values.1999');
    assert.deepEqual(item.fields[2_000], {
        kind: 'truncated',
        label: 'More values',
        path: '',
        value: 'Adaptive rendering is limited to 2,000 values and 100 nesting levels. The complete card remains available in Raw JSON.',
    });
    assert.match(item.rawText, /9999/);
});

test('caps specialized analysis depth without rejecting valid deeply nested JSON', () => {
    const depth = 10_000;
    const nestedValue = `${'['.repeat(depth)}"complete"${']'.repeat(depth)}`;
    const source = `[${nestedValue}]`;
    const dataset = parseJSONL(source, 'json');
    const [item] = dataset.items;

    assert.equal(dataset.items.length, 1);
    assert.equal(dataset.errors.length, 0);
    assert.deepEqual(item.fields, [{
        kind: 'truncated',
        label: 'More values',
        path: '',
        value: 'Adaptive rendering is limited to 2,000 values and 100 nesting levels. The complete card remains available in Raw JSON.',
    }]);
    assert.equal(item.rawText, nestedValue);
});

test('uses safe serialization when value limits are reached before deep nesting', () => {
    const values = Array.from({ length: 2_000 }, (_, index) => index).join(',');
    const depth = 10_000;
    const nestedValue = `${'['.repeat(depth)}"complete"${']'.repeat(depth)}`;
    const source = `{"values":[${values}],"deep":${nestedValue}}`;
    const dataset = parseJSONL(source, 'json');
    const [item] = dataset.items;

    assert.equal(dataset.items.length, 1);
    assert.equal(dataset.errors.length, 0);
    assert.equal(item.fields.at(-1).kind, 'truncated');
    assert.equal(item.rawText, source);
});

test('counts depth-truncated branches toward the analysis value limit', () => {
    const values = Array.from({ length: 10_000 }, (_, index) => index).join(',');
    const wrappers = 99;
    const source = `{"deep":${'['.repeat(wrappers)}[${values}]${']'.repeat(wrappers)}}`;
    const dataset = parseJSONL(source, 'json');
    const [item] = dataset.items;

    assert.equal(dataset.items.length, 1);
    assert.equal(dataset.errors.length, 0);
    assert.deepEqual(item.fields, [{
        kind: 'truncated',
        label: 'More values',
        path: '',
        value: 'Adaptive rendering is limited to 2,000 values and 100 nesting levels. The complete card remains available in Raw JSON.',
    }]);
    assert.match(item.rawText, /9999/);
});

test('clamps empty and out-of-range pages safely', () => {
    assert.deepEqual(paginateCases([], 10, 50), {
        items: [],
        page: 0,
        pageCount: 1,
        pageSize: 50,
        start: 0,
        end: 0,
        total: 0,
    });

    const page = paginateCases([{ id: 'one' }], -5, 0);
    assert.equal(page.page, 0);
    assert.equal(page.pageSize, 50);
    assert.equal(page.items.length, 1);
});
