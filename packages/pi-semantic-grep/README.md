# @howaboua/pi-semantic-grep

Adds an agent-callable `semantic_grep` tool for finding code and documentation by meaning rather than exact text. Each repository gets a local SQLite index under `.pi/`; embeddings come from an OpenAI-compatible endpoint you control.

## Install

```bash
pi install npm:@howaboua/pi-semantic-grep
```

The package depends on the native `better-sqlite3` module and requires an environment where npm can install or load its binary.

## Configuration

On first load, the extension creates `~/.pi/agent/semantic-grep.json`. The endpoint must accept OpenAI-style `/v1/embeddings` requests and return `data[].embedding` vectors.

```json
{
  "embeddings": {
    "url": "http://127.0.0.1:1234/v1/embeddings",
    "model": "text-embedding-embeddinggemma-300m-qat"
  }
}
```

Local servers such as LM Studio and llama.cpp work when they expose that shape. For hosted endpoints, set `embeddings.apiKey`.

A repository may override global settings in `.pi/semantic-grep.json`. Nested objects merge; arrays replace the global array, so repeat any default exclusions or extensions you still need.

## Indexing

The index is stored at `<repo>/.pi/semantic-grep.sqlite`. With `autoIndex.enabled` (the default), it syncs at session start.

`autoIndex.mode` controls the work:

- `incremental` — embed new and changed files, remove deleted files
- `missing` — build only when the SQLite file does not exist
- `always` — rebuild the entire index on every session start

Indexing or schema changes force a rebuild. Symlinks are ignored unless `indexing.followSymlinks` is enabled.

## Safety defaults

The indexer requires a project marker and refuses broad filesystem, home, system, and common personal-data roots. These checks are configurable under `safety`.

## Tool

```ts
semantic_grep({
  query: string,
  top_k?: number
})
```

Results include ranked paths, line ranges, scores, and snippets. The default count is 8 and maximum is 30.

```ts
semantic_grep({ query: "where are tool calls dispatched?", top_k: 5 })
```

Use normal text search when you need an exact symbol or literal occurrence.

## Current limits

Ranking uses brute-force cosine similarity over SQLite vectors. It needs no Python, FAISS, background service, or separate vector database, but is not aimed at very large repositories.
