browser benchmarks comparing different methods for storing nostr events in the browser.

- https://www.npmjs.com/package/@snort/worker-relay (which uses wasm sqlite on top of OPFS)
- https://jsr.io/@nostr/gadgets/doc/store/~/IDBEventStore (which uses raw indexeddb with reasonable optimizations and insane indexes)

## results



## to run

```
vite build
vite preview
```

then open the browser.

it should delete existing OPFS and IDB before running, but maybe just to be sure you could also manually delete all cookies and data for your localhost.
