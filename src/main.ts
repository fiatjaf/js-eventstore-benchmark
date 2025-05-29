import { Bench } from "benchmate"
import { WorkerRelayInterface } from "@snort/worker-relay"
import { IDBEventStore } from "@nostr/gadgets/store"
import { finalizeEvent, getPublicKey } from "@nostr/tools/pure"
import { hexToBytes } from "@nostr/tools/utils"
import WorkerVite from "@snort/worker-relay/src/worker?worker"
import diff from "@openjs/superdiff"

import { clearOPFS } from "./utils"

// IDBEventStore setup
await new Promise<void>(
  resolve =>
    (indexedDB.deleteDatabase("@nostr/gadgets/events/benchmark").onsuccess = () => {
      console.log("IDB cleared")
      resolve()
    })
)
const store = new IDBEventStore("@nostr/gadgets/events/benchmark")
console.log("idb ready")

// worker-relay setup
await clearOPFS()
const workerScript = import.meta.env.DEV
  ? new URL("@snort/worker-relay/dist/esm/worker.mjs", import.meta.url)
  : new WorkerVite()
const workerRelay = new WorkerRelayInterface(workerScript)
await workerRelay.init({
  databasePath: "relay.db",
  insertBatchSize: 100
})
console.log("sqlite ready")

// prepare events
const sk1 = hexToBytes("0000000000000000000000000000000000000000000000000000000000000001")
const sk2 = hexToBytes("0000000000000000000000000000000000000000000000000000000000000002")
const sk3 = hexToBytes("0000000000000000000000000000000000000000000000000000000000000003")

console.log("preparing events")
let promises: Promise<void>[] = []
for (let i = 0; i < 5000; i++) {
  const evt = {
    kind: [1, 11, 1111][i % 3],
    created_at: i,
    content: "hello " + i,
    tags: [["t", i % 2 === 0 ? "even" : "odd"]]
  }
  if (i % 3)
    evt.tags.push(["e", "285bb0f909edbf03158d44f350bcfce51dca9106909f42215dd8f8bdcb988d7f"])
  if (i % 7) evt.tags.push(["i", "https://banana.com"])
  if (i % 14)
    evt.tags.push(["p", getPublicKey([sk1, sk2, sk3].filter((_, si) => si !== i % 3)[i % 2])])
  const event = finalizeEvent(evt, [sk1, sk2, sk3][i % 3])

  promises.push(
    workerRelay.event(event).then(p => {
      if (!p.ok) throw new Error("not ok: " + p.message)
    })
  )
  promises.push(store.saveEvent(event))
}
await Promise.all(promises)

// run benchmarks
console.log("running benchmarks")
const bench = new Bench()

for (let query of [
  {
    name: "basic",
    filter: { limit: 50 }
  },
  {
    name: "basic-huge",
    filter: { since: 3000, limit: 1500 }
  },
  {
    name: "kind",
    filter: { kinds: [11], limit: 120 }
  },
  {
    name: "pubkey-kind-since-until",
    filter: {
      "#e": ["285bb0f909edbf03158d44f350bcfce51dca9106909f42215dd8f8bdcb988d7f"],
      limit: 200
    }
  },
  {
    name: "pubkey-kind-since-until-huge",
    filter: {
      "#e": ["285bb0f909edbf03158d44f350bcfce51dca9106909f42215dd8f8bdcb988d7f"],
      limit: 2000,
      until: 4000
    }
  },
  {
    name: "tag",
    filter: { "#p": [getPublicKey(sk1), getPublicKey(sk2)], limit: 200 }
  },
  {
    name: "kind-tags",
    filter: {
      kinds: [1, 1111],
      "#t": ["even"],
      limit: 500
    }
  }
]) {
  const sqlite = (await workerRelay.query(["REQ", "_", query.filter])).map(evt => {
    delete evt.relays
    return evt
  })
  const idb = await Array.fromAsync(store.queryEvents(query.filter, 5000))
  const delta = diff(sqlite, idb)
  if (delta.length) {
    console.warn("inconsistency detected", query.name, delta, "sqlite:", sqlite, "idb:", idb)
  }

  bench.add(`sqlite:query:${query.name} (ops/s)`, async () => {
    await workerRelay.query(["REQ", "_", query.filter])
  })
  bench.add(`idb:query:${query.name} (ops/s)`, async () => {
    await Array.fromAsync(store.queryEvents(query.filter, 5000))
  })
}

for (let result of await bench.run()) {
  const { min, max, average } = result.stats.opsPerSecond
  console.table({ min, max, average })
  console.log(
    "%c" + result.name + "\n",
    result.name.startsWith("idb")
      ? "background: #222; color: #bada55"
      : "background: #222; color: #e7700d"
  )
}
