browser benchmarks comparing different methods for storing nostr events in the browser.

- https://www.npmjs.com/package/@snort/worker-relay (which uses wasm sqlite on top of OPFS)
- https://jsr.io/@nostr/gadgets/doc/store/~/IDBEventStore (which uses raw indexeddb with reasonable optimizations and insane indexes)

## results

the results sample come as screenshots from my browser:

![](https://github.com/user-attachments/assets/9bc39448-140b-4daf-a64f-2d15b9ab7389)
![](https://github.com/user-attachments/assets/c1131e86-68dc-49a6-91f9-7f20e12875f7)


## to run

```
vite build
vite preview
```

then open the browser.

it should delete existing OPFS and IDB before running, but maybe just to be sure you could also manually delete all cookies and data for your localhost.
