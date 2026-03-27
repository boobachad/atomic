# Plan: Async AtomicCore — Eliminate the Sync Bridge for Postgres Scalability

## Context

The storage abstraction is complete: `StorageBackend` dispatches to either SQLite or Postgres at runtime. However, every Postgres call goes through a sync→async bridge (`block_on`) that spawns a background thread per DB operation. With actix-web's `current_thread` worker model, this means:

1. Route handler → `web::block()` → threadpool thread
2. Threadpool thread → dispatch method → detects tokio runtime → spawns another thread
3. That thread → `PG_RUNTIME.block_on()` → actual sqlx query

Three layers of thread coordination per database call. This caps throughput at roughly the size of the thread pools, and adds ~100μs of overhead per call from thread spawning/joining.

**Goal:** Make AtomicCore natively async so Postgres calls go directly through `async trait` methods with zero bridging. SQLite calls use `spawn_blocking` internally (one thread hop instead of three).

## Current State

- **111 dispatch methods** in `storage/mod.rs` (the `dispatch!` macro), all bridging sync→async for Postgres
- **~80 public sync methods** on `AtomicCore` that call these dispatch methods
- **~50 actix-web route handlers** that wrap AtomicCore sync calls in `web::block()`
- **3 async methods** on AtomicCore already: `search()`, `generate_wiki()`, `update_wiki()`, `send_chat_message()`
- **Embedding pipeline** already async internally but calls `*_sync` dispatch methods
- **Agent/wiki modules** already async but call `*_sync` dispatch methods
- **Tauri desktop** — no impact, uses HTTP API via sidecar

## Migration Steps

### Step 1: Make AtomicCore Methods Async

Convert all ~80 public methods from `pub fn` to `pub async fn`. The method bodies stay the same — they call dispatch methods which handle the backend routing. The `async` keyword is needed so that later steps can remove the sync bridge.

**Pattern:**
```rust
// Before
pub fn get_atom(&self, id: &str) -> Result<Option<AtomWithTags>, AtomicCoreError> {
    self.storage.get_atom_impl(id)
}

// After
pub async fn get_atom(&self, id: &str) -> Result<Option<AtomWithTags>, AtomicCoreError> {
    self.storage.get_atom_impl(id)  // Still sync dispatch for now
}
```

This is a breaking API change — all callers add `.await`. But the behavior is identical; we're just adding the `async` annotation in preparation.

**Files:** `crates/atomic-core/src/lib.rs`

### Step 2: Update Server Route Handlers

Remove `web::block()` wrappers from all actix-web handlers. Since AtomicCore methods are now async, handlers can `.await` them directly.

**Pattern:**
```rust
// Before
pub async fn get_atom(db: Db, path: web::Path<String>) -> HttpResponse {
    let id = path.into_inner();
    let core = db.0;
    match web::block(move || core.get_atom(&id)).await {
        Ok(Ok(Some(atom))) => HttpResponse::Ok().json(atom),
        ...
    }
}

// After
pub async fn get_atom(db: Db, path: web::Path<String>) -> HttpResponse {
    let id = path.into_inner();
    match db.0.get_atom(&id).await {
        Ok(Some(atom)) => HttpResponse::Ok().json(atom),
        ...
    }
}
```

The `blocking_ok` helper and similar wrappers get replaced with a simpler `async_ok` pattern.

**Files:** All files in `crates/atomic-server/src/routes/`

### Step 3: Replace Dispatch Macro with Async Routing

Replace the 111-method `dispatch!` macro with direct async trait calls on `StorageBackend`. Each method calls the trait method directly — for Postgres it's natively async, for SQLite it wraps in `spawn_blocking`.

**Pattern:**
```rust
impl StorageBackend {
    pub async fn get_atom(&self, id: &str) -> StorageResult<Option<AtomWithTags>> {
        match self {
            StorageBackend::Sqlite(s) => {
                let s = s.clone();
                let id = id.to_string();
                tokio::task::spawn_blocking(move || s.get_atom_impl(&id))
                    .await
                    .map_err(|e| AtomicCoreError::DatabaseOperation(e.to_string()))?
            }
            #[cfg(feature = "postgres")]
            StorageBackend::Postgres(s) => {
                <PostgresStorage as AtomStore>::get_atom(s, id).await
            }
        }
    }
}
```

This eliminates `PG_RUNTIME`, the `block_on` function, and the thread-spawning bridge entirely. For Postgres: zero overhead — the sqlx future runs directly on actix's tokio runtime. For SQLite: one `spawn_blocking` hop to the threadpool (same as current `web::block` pattern).

**Files:** `crates/atomic-core/src/storage/mod.rs`

### Step 4: Update Internal Modules

The embedding pipeline, agent, wiki, and search modules already use `StorageBackend` but call `*_sync` methods. Change them to `.await` the new async methods.

**Pattern:**
```rust
// Before (embedding.rs)
storage.set_embedding_status_sync(atom_id, "processing")?;

// After
storage.set_embedding_status(atom_id, "processing").await?;
```

These modules are already async, so this is a mechanical find-and-replace of `_sync` / `_impl` suffixed calls with `.await` versions.

**Files:**
- `crates/atomic-core/src/embedding.rs`
- `crates/atomic-core/src/agent.rs`
- `crates/atomic-core/src/wiki/mod.rs`, `wiki/centroid.rs`, `wiki/agentic.rs`
- `crates/atomic-core/src/search.rs`

### Step 5: Remove SQLite Special-Case Paths

Currently `search()`, `send_chat_message()`, and wiki generation have `if let Some(sqlite) = self.storage.as_sqlite()` branches that bypass the storage trait. With async dispatch these branches are unnecessary — both backends go through the same async trait interface.

Remove the `as_sqlite()` checks and unify to a single code path. Remove `as_sqlite()` and `as_postgres()` methods from `StorageBackend`.

**Files:**
- `crates/atomic-core/src/lib.rs` (search, wiki save paths)
- `crates/atomic-core/src/agent.rs` (execute_search_atoms)
- `crates/atomic-core/src/storage/mod.rs` (remove as_sqlite/as_postgres)

### Step 6: Cleanup

- Remove `PG_RUNTIME` lazy static and `block_on` / `pg_runtime_block_on` functions
- Remove `sqlite_db()` method from `StorageBackend`
- Remove the `dispatch!` macro
- Remove `*_sync` and `*_impl` suffixed methods from `SqliteStorage` (keep only the async trait impls, which internally use `spawn_blocking`)
- Clean up unused imports

**Files:** `crates/atomic-core/src/storage/mod.rs`, `storage/sqlite/*.rs`

## Execution Order and Dependencies

```
Step 1 (AtomicCore async) ──→ Step 2 (Routes)
         │
         └──────────────────→ Step 3 (Dispatch replacement)
                                      │
                                      └──→ Step 4 (Internal modules)
                                                    │
                                                    └──→ Step 5 (Remove special cases)
                                                                  │
                                                                  └──→ Step 6 (Cleanup)
```

Steps 1→2 and 1→3 can be done in parallel after Step 1. Steps 4-6 are sequential.

## What Stays The Same

- **Storage trait definitions** (`traits.rs`) — already async, no changes
- **PostgresStorage implementations** — already async, no changes
- **SqliteStorage trait implementations** — already have async wrappers, just need `spawn_blocking` added inside
- **Tauri desktop app** — uses HTTP API, no AtomicCore calls
- **Frontend** — HTTP API unchanged
- **Test suite** — tests use `#[tokio::test]`, adding `.await` is mechanical

## Verification

1. `cargo test --workspace` — all tests pass with `.await` additions
2. `cargo test -p atomic-core --test storage_tests --features postgres -- --test-threads=1` with Postgres running — parameterized tests pass
3. Benchmark: measure p50/p99 latency of `/api/atoms` endpoint before and after, under concurrent load, comparing SQLite and Postgres
4. Load test: 50 concurrent users hitting the API — server should not exhaust thread pools

## Scaling Considerations Beyond Async

Once the async migration is done, further scaling for organizations:

- **Connection pooling tuning** — `PgPoolOptions::max_connections` based on expected concurrency
- **Read replicas** — `PostgresStorage` could hold separate read/write pools
- **Request-scoped DB** — currently `Db` extractor resolves core per-request, which is correct for multi-db; for single-db deployments, skip the resolution overhead
- **Caching layer** — frequently-accessed data (tag tree, settings) cached in-memory with TTL, reducing DB round-trips
- **Horizontal scaling** — multiple atomic-server instances sharing one Postgres, with WebSocket events via Redis pub/sub instead of in-process broadcast channels
