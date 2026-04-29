use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

// ==================== Tool Input Types ====================

/// Input parameters for semantic_search tool
#[derive(Debug, Deserialize, JsonSchema)]
pub struct SemanticSearchParams {
    /// The search query to find relevant atoms using vector similarity
    pub query: String,

    /// Maximum number of results to return (default: 10, max: 50)
    #[serde(default)]
    pub limit: Option<i32>,

    /// Optional recency filter: only return atoms created within the last N days.
    /// Use this when the user asks about recent notes ("this week", "last month", etc.).
    #[serde(default)]
    pub since_days: Option<i32>,
}

/// Input parameters for read_atom tool
#[derive(Debug, Deserialize, JsonSchema)]
pub struct ReadAtomParams {
    /// The UUID of the atom to retrieve
    pub atom_id: String,

    /// Maximum number of lines to return (default: 500, max: 500)
    #[serde(default)]
    pub limit: Option<i32>,

    /// Line offset for pagination, 0-indexed (default: 0)
    #[serde(default)]
    pub offset: Option<i32>,
}

/// Input parameters for create_atom tool
#[derive(Debug, Deserialize, JsonSchema)]
pub struct CreateAtomParams {
    /// The markdown content of the atom
    pub content: String,

    /// Optional source URL where this content originated
    #[serde(default)]
    pub source_url: Option<String>,
}

/// Input parameters for update_atom tool
#[derive(Debug, Deserialize, JsonSchema)]
pub struct UpdateAtomParams {
    /// The UUID of the atom to update
    pub atom_id: String,

    /// The new markdown content for the atom
    pub content: String,

    /// Optional source URL where this content originated
    #[serde(default)]
    pub source_url: Option<String>,
}

/// Input parameters for ingest_url tool
#[derive(Debug, Deserialize, JsonSchema)]
pub struct IngestUrlParams {
    /// URL to fetch, extract, and save as an atom. Exact source_url matches return the existing atom.
    pub url: String,

    /// Optional tag IDs to assign when a new atom is created. Ignored if the URL already exists.
    #[serde(default)]
    pub tag_ids: Vec<String>,

    /// Optional title hint to use instead of the extracted article title for a new atom.
    #[serde(default)]
    pub title_hint: Option<String>,

    /// Optional publication date override for a new atom, as an ISO 8601 string.
    #[serde(default)]
    pub published_at: Option<String>,
}

// ==================== Tool Output Types ====================

/// A search result with atom content and similarity score
#[derive(Debug, Serialize)]
pub struct SearchResult {
    pub atom_id: String,
    pub content_preview: String,
    pub similarity_score: f32,
    pub matching_chunk: String,
}

/// Paginated atom content response
#[derive(Debug, Serialize)]
pub struct AtomContent {
    pub atom_id: String,
    pub content: String,
    pub total_lines: i32,
    pub returned_lines: i32,
    pub offset: i32,
    pub has_more: bool,
    pub created_at: String,
    pub updated_at: String,
}

/// Created/updated atom response
#[derive(Debug, Serialize)]
pub struct AtomResponse {
    pub atom_id: String,
    pub content_preview: String,
    pub tags: Vec<String>,
    pub embedding_status: String,
}

/// Ingested URL response
#[derive(Debug, Serialize)]
pub struct IngestUrlResponse {
    pub atom_id: String,
    pub url: String,
    pub title: String,
    pub content_length: usize,
    pub already_exists: bool,
}
