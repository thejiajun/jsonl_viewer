import { parseJSONL } from './jsonl_parser.mjs';

self.addEventListener('message', (event) => {
    const { id, text, formatHint } = event.data;

    try {
        self.postMessage({
            id,
            dataset: parseJSONL(text, formatHint),
        });
    } catch (error) {
        self.postMessage({
            id,
            error: error instanceof Error ? error.message : String(error),
        });
    }
});
