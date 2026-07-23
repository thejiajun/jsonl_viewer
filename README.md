# JSONL Viewer

A local-first viewer for reviewing JSONL prompts and media references. Files stay in your browser and are never uploaded.

## Run locally

```bash
npm run serve
```

Open [http://localhost:8090/jsonl_viewer.html](http://localhost:8090/jsonl_viewer.html), then drag a `.jsonl` file onto the page.

Opening the HTML file directly also works in most browsers, but a local server is recommended because the app uses JavaScript modules.

## Supported shape

The viewer works with one JSON object per line. It understands:

- An optional package metadata line with `package_id`, `item_count`, or `endpoint`.
- Case identifiers in `id`.
- Prompts in `request.content[]` entries with `type: "text"`.
- Images, videos, and audio links in `image_url`, `video_url`, and `audio_url`.
- Request metadata such as `model`, `ratio`, and `duration`.

Unknown fields remain in the parsed source but are not shown in the review cards.

## Features

- Prompt and media review cards, including text-only cases.
- Search and media-presence filters.
- Collapsible raw JSON for unknown or generic fields.
- One, two, or three-column layouts.
- Line-numbered parse errors without blocking valid entries.
- Copy actions for prompts and media URLs.
- Up to five recent files stored locally in IndexedDB.
- Responsive mobile layout and keyboard-accessible controls.

## Verify

```bash
npm run check
```
