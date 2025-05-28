// Browser-compatible benchmark for Nostr event stores

// Simple event creation using Web Crypto API
function createTestEvent(index) {
  const randomId = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
  
  const randomPubkey = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
    
  const randomSig = Array.from(crypto.getRandomValues(new Uint8Array(64)))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  return {
    id: randomId,
    kind: 1,
    created_at: Math.floor(Date.now() / 1000),
    content: `Test event ${index} - ${Math.random()}`,
    tags: [],
    pubkey: randomPubkey,
    sig: randomSig
  };
}

// Mock WorkerRelay implementation for browser
class MockWorkerRelay {
  constructor() {
    this.events = new Map();
    this.name = 'MockWorkerRelay';
  }
  
  async init() {
    console.log('MockWorkerRelay: Initialized');
    await new Promise(resolve => setTimeout(resolve, 10)); // Simulate async init
  }
  
  async event(event) {
    this.events.set(event.id, event);
    return true;
  }
  
  async query(filter) {
    const results = [];
    for (const event of this.events.values()) {
      if (this.matchesFilter(event, filter[2])) {
        results.push(event);
      }
    }
    return results.slice(0, filter[2].limit || 10);
  }
  
  matchesFilter(event, filter) {
    if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
    if (filter.authors && !filter.authors.includes(event.pubkey)) return false;
    return true;
  }
}

// Mock IDBEventStore implementation using IndexedDB
class MockIDBEventStore {
  constructor(dbName = 'benchmark-test') {
    this.dbName = dbName;
    this.db = null;
    this.name = 'MockIDBEventStore';
  }
  
  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        console.log('MockIDBEventStore: Initialized');
        resolve();
      };
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('events')) {
          const store = db.createObjectStore('events', { keyPath: 'id' });
          store.createIndex('kind', 'kind', { unique: false });
          store.createIndex('pubkey', 'pubkey', { unique: false });
          store.createIndex('created_at', 'created_at', { unique: false });
        }
      };
    });
  }
  
  async saveEvent(event) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['events'], 'readwrite');
      const store = transaction.objectStore('events');
      const request = store.put(event);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }
  
  async *queryEvents(filter) {
    const transaction = this.db.transaction(['events'], 'readonly');
    const store = transaction.objectStore('events');
    
    const results = await new Promise((resolve, reject) => {
      const results = [];
      const request = store.openCursor();
      
      request.onerror = () => reject(request.error);
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          const eventData = cursor.value;
          if (this.matchesFilter(eventData, filter)) {
            results.push(eventData);
          }
          cursor.continue();
        } else {
          resolve(results);
        }
      };
    });
    
    for (const event of results) {
      yield event;
    }
  }
  
  matchesFilter(event, filter) {
    if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
    if (filter.authors && !filter.authors.includes(event.pubkey)) return false;
    return true;
  }
}

// Real package imports (will fall back to mocks if not available)
let WorkerRelayInterface, IDBEventStore;

try {
  // Try to import real packages
  const workerRelay = await import('@snort/worker-relay');
  WorkerRelayInterface = workerRelay.WorkerRelayInterface;
  console.log('✓ Using real @snort/worker-relay');
} catch (error) {
  console.log('⚠ Using mock WorkerRelay (install @snort/worker-relay for real benchmark)');
  WorkerRelayInterface = MockWorkerRelay;
}

try {
  const gadgets = await import('@nostr/gadgets/store');
  IDBEventStore = gadgets.IDBEventStore;
  console.log('✓ Using real @nostr/gadgets IDBEventStore');
} catch (error) {
  console.log('⚠ Using mock IDBEventStore (install @nostr/gadgets for real benchmark)');
  IDBEventStore = MockIDBEventStore;
}

// Benchmark function
async function benchmarkEventStore(name, store, events, ui) {
  ui.log(`\n=== Benchmarking ${name} ===`);
  
  // Initialize
  const initStart = performance.now();
  await store.init();
  const initTime = performance.now() - initStart;
  ui.log(`Initialization: ${initTime.toFixed(2)}ms`);
  
  // Benchmark adding events
  ui.log(`Adding ${events.length} events...`);
  const addStart = performance.now();
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (store.event) {
      await store.event(event);
    } else {
      await store.saveEvent(event);
    }
    
    // Update progress every 100 events
    if (i % 100 === 0) {
      const progress = ((i / events.length) * 50); // First 50% for adding
      ui.updateProgress(progress);
      await new Promise(resolve => setTimeout(resolve, 0)); // Allow UI update
    }
  }
  const addTime = performance.now() - addStart;
  ui.log(`Adding ${events.length} events: ${addTime.toFixed(2)}ms (${(addTime/events.length).toFixed(2)}ms per event)`);
  
  // Benchmark querying events
  ui.log(`Querying events...`);
  const queryStart = performance.now();
  let queryResults;
  
  if (store.query) {
    // WorkerRelay style
    queryResults = await store.query(["REQ", "test", { kinds: [1], limit: events.length }]);
  } else {
    // IDBEventStore style
    queryResults = [];
    for await (const event of store.queryEvents({ kinds: [1], limit: events.length })) {
      queryResults.push(event);
    }
  }
  
  const queryTime = performance.now() - queryStart;
  ui.log(`Querying ${queryResults.length} events: ${queryTime.toFixed(2)}ms`);
  
  return {
    name,
    initTime,
    addTime,
    queryTime,
    eventsAdded: events.length,
    eventsQueried: queryResults.length
  };
}

// UI Management
class BenchmarkUI {
  constructor() {
    this.outputElement = document.getElementById('output');
    this.resultsElement = document.getElementById('results');
    this.progressContainer = document.getElementById('progressContainer');
    this.progressBar = document.getElementById('progressBar');
    this.runButton = document.getElementById('runBenchmark');
    this.clearButton = document.getElementById('clearOutput');
    this.eventCountInput = document.getElementById('eventCount');
    
    this.setupEventListeners();
  }
  
  setupEventListeners() {
    this.runButton.addEventListener('click', () => this.runBenchmark());
    this.clearButton.addEventListener('click', () => this.clearOutput());
  }
  
  log(message) {
    this.outputElement.textContent += message + '\n';
    this.outputElement.scrollTop = this.outputElement.scrollHeight;
  }
  
  clearOutput() {
    this.outputElement.textContent = '';
    this.resultsElement.innerHTML = '';
  }
  
  updateProgress(percent) {
    this.progressBar.style.width = `${percent}%`;
  }
  
  showProgress() {
    this.progressContainer.style.display = 'block';
  }
  
  hideProgress() {
    this.progressContainer.style.display = 'none';
  }
  
  setButtonState(disabled) {
    this.runButton.disabled = disabled;
    this.runButton.textContent = disabled ? 'Running...' : 'Run Benchmark';
  }
  
  displayResults(results) {
    this.resultsElement.innerHTML = '';
    
    if (results.length >= 2) {
      const [result1, result2] = results;
      
      // Determine winners
      const initWinner = result1.initTime < result2.initTime ? 0 : 1;
      const addWinner = result1.addTime < result2.addTime ? 0 : 1;
      const queryWinner = result1.queryTime < result2.queryTime ? 0 : 1;
      
      const total1 = result1.initTime + result1.addTime + result1.queryTime;
      const total2 = result2.initTime + result2.addTime + result2.queryTime;
      const totalWinner = total1 < total2 ? 0 : 1;
      
      results.forEach((result, index) => {
        const card = document.createElement('div');
        card.className = `result-card ${index === totalWinner ? 'winner' : ''}`;
        
        card.innerHTML = `
          <h3>${result.name} ${index === totalWinner ? '🏆' : ''}</h3>
          <div class="metric">
            <span class="metric-label">Initialization:</span>
            <span class="metric-value">${result.initTime.toFixed(2)}ms ${index === initWinner ? '🥇' : ''}</span>
          </div>
          <div class="metric">
            <span class="metric-label">Adding Events:</span>
            <span class="metric-value">${result.addTime.toFixed(2)}ms ${index === addWinner ? '🥇' : ''}</span>
          </div>
          <div class="metric">
            <span class="metric-label">Querying Events:</span>
            <span class="metric-value">${result.queryTime.toFixed(2)}ms ${index === queryWinner ? '🥇' : ''}</span>
          </div>
          <div class="metric">
            <span class="metric-label">Total Time:</span>
            <span class="metric-value">${(result.initTime + result.addTime + result.queryTime).toFixed(2)}ms</span>
          </div>
          <div class="metric">
            <span class="metric-label">Events Processed:</span>
            <span class="metric-value">${result.eventsAdded}</span>
          </div>
        `;
        
        this.resultsElement.appendChild(card);
      });
    }
  }
  
  async runBenchmark() {
    this.setButtonState(true);
    this.showProgress();
    this.updateProgress(0);
    this.clearOutput();
    
    try {
      this.log('🚀 Starting Nostr Event Store Benchmark\n');
      
      // Generate test events
      const eventCount = parseInt(this.eventCountInput.value) || 1000;
      const events = [];
      
      this.log(`Generating ${eventCount} test events...`);
      for (let i = 0; i < eventCount; i++) {
        events.push(createTestEvent(i));
      }
      this.log(`✓ Generated ${eventCount} events\n`);
      
      // Initialize stores
      const workerRelay = WorkerRelayInterface === MockWorkerRelay 
        ? new MockWorkerRelay() 
        : new WorkerRelayInterface();
        
      const idbStore = new IDBEventStore('benchmark-test');
      
      // Run benchmarks
      const results = [];
      
      try {
        this.updateProgress(10);
        results.push(await benchmarkEventStore('WorkerRelay', workerRelay, events, this));
        this.updateProgress(60);
      } catch (error) {
        this.log(`WorkerRelay benchmark failed: ${error.message}`);
      }
      
      try {
        results.push(await benchmarkEventStore('IDBEventStore', idbStore, events, this));
        this.updateProgress(100);
      } catch (error) {
        this.log(`IDBEventStore benchmark failed: ${error.message}`);
      }
      
      // Display results
      if (results.length > 0) {
        this.displayResults(results);
        
        // Print comparison
        this.log('\n📊 BENCHMARK RESULTS COMPARISON');
        this.log('================================');
        
        if (results.length >= 2) {
          const [result1, result2] = results;
          
          this.log(`\nInitialization:`);
          this.log(`  ${result1.name}: ${result1.initTime.toFixed(2)}ms`);
          this.log(`  ${result2.name}: ${result2.initTime.toFixed(2)}ms`);
          this.log(`  Winner: ${result1.initTime < result2.initTime ? result1.name : result2.name}`);
          
          this.log(`\nAdding Events:`);
          this.log(`  ${result1.name}: ${result1.addTime.toFixed(2)}ms`);
          this.log(`  ${result2.name}: ${result2.addTime.toFixed(2)}ms`);
          this.log(`  Winner: ${result1.addTime < result2.addTime ? result1.name : result2.name}`);
          
          this.log(`\nQuerying Events:`);
          this.log(`  ${result1.name}: ${result1.queryTime.toFixed(2)}ms`);
          this.log(`  ${result2.name}: ${result2.queryTime.toFixed(2)}ms`);
          this.log(`  Winner: ${result1.queryTime < result2.queryTime ? result1.name : result2.name}`);
          
          const total1 = result1.initTime + result1.addTime + result1.queryTime;
          const total2 = result2.initTime + result2.addTime + result2.queryTime;
          
          this.log(`\nTotal Time:`);
          this.log(`  ${result1.name}: ${total1.toFixed(2)}ms`);
          this.log(`  ${result2.name}: ${total2.toFixed(2)}ms`);
          this.log(`  Overall Winner: ${total1 < total2 ? result1.name : result2.name}`);
        } else {
          results.forEach(result => {
            this.log(`\n${result.name}:`);
            this.log(`  Init: ${result.initTime.toFixed(2)}ms`);
            this.log(`  Add: ${result.addTime.toFixed(2)}ms`);
            this.log(`  Query: ${result.queryTime.toFixed(2)}ms`);
          });
        }
      }
    } catch (error) {
      this.log(`\n❌ Benchmark failed: ${error.message}`);
      console.error('Benchmark error:', error);
    } finally {
      this.setButtonState(false);
      this.hideProgress();
    }
  }
}

// Initialize the UI when the page loads
document.addEventListener('DOMContentLoaded', () => {
  new BenchmarkUI();
});