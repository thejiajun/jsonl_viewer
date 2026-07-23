import assert from 'node:assert/strict';
import test from 'node:test';

import {
    filterCases,
    formatBytes,
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
    'null',
].join('\n');

test('parses package metadata, cases, media, and invalid lines', () => {
    const dataset = parseJSONL(fixture);

    assert.equal(dataset.metadata.package_id, 'media-review');
    assert.equal(dataset.items.length, 2);
    assert.equal(dataset.mediaCount, 2);
    assert.equal(dataset.textOnlyCount, 1);
    assert.equal(dataset.errors.length, 2);
    assert.equal(dataset.errors[0].line, 4);
    assert.equal(dataset.errors[1].line, 5);
    assert.equal(dataset.errors[1].message, 'Expected a JSON object');
    assert.equal(dataset.items[0].prompt, 'A blue car drives past the camera.');
    assert.deepEqual(
        dataset.items[0].media.map(({ type, role }) => ({ type, role })),
        [
            { type: 'image', role: 'first_frame' },
            { type: 'video', role: 'reference' },
        ],
    );
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

test('formats file sizes for the UI', () => {
    assert.equal(formatBytes(0), '0 B');
    assert.equal(formatBytes(512), '512 B');
    assert.equal(formatBytes(2048), '2.0 KB');
    assert.equal(formatBytes(2 * 1024 * 1024), '2.0 MB');
});
