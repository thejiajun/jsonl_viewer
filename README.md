# JSONL Viewer

A local-first viewer that renders every JSONL line as an adaptive content card. Files stay in your browser and are never uploaded.

## Run locally

```bash
npm run serve
```

Open [http://localhost:8090/jsonl_viewer.html](http://localhost:8090/jsonl_viewer.html), then drag a `.json` or `.jsonl` file onto the page.

Use the deployed site or a local server. Do not open the HTML through `file://`; browsers can block its JavaScript modules from loading.

## Content detection

The viewer accepts:

- A JSON object as one card.
- A JSON array as one card per array element.
- JSONL as one card per valid line.

Every value remains available in Raw JSON; common values also receive adaptive card renderers. Adaptive analysis is capped at 2,000 values and 100 nesting levels per card.

When it has enough evidence, the viewer adds a specialized renderer:

- Text and prompt containers use explicit text types, common semantic field names, or long-form text.
- Image, video, and audio containers use an explicit type or MIME, a recognizable file extension, or a strong field-name hint.
- Unknown URLs stay as normal links. The viewer does not make network requests just to guess their type.
- Numbers, booleans, nulls, arrays, nested objects, and unknown strings use the generic Fields container.
- An optional package metadata line is identified by `package_id` or `item_count` and may also include `endpoint`.

## Features

- One content card for every valid JSONL line.
- Specialized text, prompt, image, video, audio, link, and structured-field renderers.
- Search and media-presence filters.
- Background parsing in a Web Worker so large files do not freeze the interface.
- A 50-card render window with pagination, keeping the DOM small even for 10,000+ cards.
- Debounced search plus 12-at-a-time media loading inside unusually large cards.
- Viewport-aware video playback: visible videos play with sound when the browser allows it, and pause after leaving the viewport.
- Audio remains user-controlled and starts unmuted.
- Collapsible raw JSON for unknown or generic fields.
- Raw JSON and extra field elements are created only when expanded.
- Very large field lists load 100 at a time; oversized Raw JSON previews are capped while Copy JSON remains complete.
- One, two, or three-column layouts.
- Line-numbered parse errors without blocking valid entries.
- Copy actions for prompts and media URLs.
- Up to five recent files stored locally in IndexedDB.
- Responsive mobile layout and keyboard-accessible controls.

## Verify

```bash
npm run check
```

The automated suite includes a 10,000-card parsing and pagination regression test.
