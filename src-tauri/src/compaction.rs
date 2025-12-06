use crate::extraction::get_tag_tree_for_llm;
use crate::providers::traits::LlmConfig;
use crate::providers::types::{GenerationParams, Message, StructuredOutputSchema};
use crate::providers::{create_llm_provider, ProviderConfig};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

// ============================================================================
// TYPES
// ============================================================================

/// Phase 1: Categorization result - which top-level tags should be moved
#[derive(Debug, Deserialize)]
pub struct CategorizationResult {
    pub moves: Vec<TagMove>,
}

#[derive(Debug, Deserialize)]
pub struct TagMove {
    pub tag_name: String,
    pub new_parent_name: String,
    pub reason: String,
}

/// Phase 2: Merge result - which tags should be merged together
#[derive(Debug, Deserialize)]
pub struct MergeResult {
    pub merges: Vec<TagMerge>,
}

#[derive(Debug, Deserialize)]
pub struct TagMerge {
    pub winner_name: String,
    pub loser_name: String,
    pub reason: String,
}

/// Final compaction result for frontend
#[derive(Debug, Clone, Serialize)]
pub struct CompactionResult {
    pub tags_moved: i32,
    pub tags_merged: i32,
    pub atoms_retagged: i32,
}

// ============================================================================
// SYSTEM PROMPTS
// ============================================================================

const CATEGORIZATION_SYSTEM_PROMPT: &str = r#"You are a tag hierarchy optimization assistant. Your task is to identify top-level tags that should be moved under other top-level tags to create a cleaner hierarchy.

RULES:
1. Only consider tags at the root level (the ones listed below)
2. Suggest moving a tag ONLY if there's a clear "is-a" or "belongs-under" relationship
3. Do NOT move category container tags like "Topics", "People", "Locations", "Organizations", "Events", "Concepts"
4. Be conservative - only suggest moves you're highly confident about
5. Keep at least 3 top-level tags - don't consolidate everything

EXAMPLES of good moves:
- "Programming" -> under "Topics" (programming is a topic)
- "New York" -> under "Locations" (New York is a location)
- "Apple Inc" -> under "Organizations"
- "Machine Learning" -> under "Topics" (if "Topics" exists)

EXAMPLES of BAD moves (don't do these):
- "Topics" -> under anything (Topics is a category container)
- "People" -> under anything (People is a category container)
- "AI" -> under "Machine Learning" (AI is broader, not narrower)

Return an empty moves array if no clear moves are warranted."#;

const MERGE_SYSTEM_PROMPT: &str = r#"You are a tag deduplication assistant. Your task is to identify tags that are duplicates or too similar and should be merged.

RULES:
1. Merge tags that refer to the same concept (e.g., "React" and "React.js" and "ReactJS")
2. Merge tags that are case variations (e.g., "AI" and "ai")
3. Merge tags with slight spelling differences (e.g., "Javascript" and "JavaScript")
4. The "winner" should be the more canonical/common name
5. Do NOT merge tags that are genuinely different concepts
6. Do NOT merge parent category tags with their children (e.g., "Topics" and "AI")
7. Do NOT merge a tag into one of its ancestors or descendants
8. Be conservative - only merge when you're highly confident they're the same thing

EXAMPLES of good merges:
- Winner: "React", Loser: "React.js" (same framework)
- Winner: "Machine Learning", Loser: "ML" (same concept, abbreviation)
- Winner: "JavaScript", Loser: "Javascript" (case variation)
- Winner: "United States", Loser: "USA" (same country)

EXAMPLES of BAD merges (don't do these):
- "AI" and "Machine Learning" (related but distinct concepts)
- "React" and "Vue" (different frameworks)
- "Topics" and "Concepts" (different organizational categories)
- "Programming" and "JavaScript" (one is broader than the other)

Return an empty merges array if no clear merges are warranted."#;

// ============================================================================
// JSON SCHEMAS
// ============================================================================

fn categorization_schema() -> serde_json::Value {
    serde_json::json!({
        "type": "object",
        "properties": {
            "moves": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "tag_name": {
                            "type": "string",
                            "description": "Name of the top-level tag to move"
                        },
                        "new_parent_name": {
                            "type": "string",
                            "description": "Name of the tag to move it under (must be another top-level tag)"
                        },
                        "reason": {
                            "type": "string",
                            "description": "Brief explanation for why this move makes sense"
                        }
                    },
                    "required": ["tag_name", "new_parent_name", "reason"],
                    "additionalProperties": false
                },
                "description": "List of tags to move under other tags"
            }
        },
        "required": ["moves"],
        "additionalProperties": false
    })
}

fn merge_schema() -> serde_json::Value {
    serde_json::json!({
        "type": "object",
        "properties": {
            "merges": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "winner_name": {
                            "type": "string",
                            "description": "Name of the tag that should survive (canonical name)"
                        },
                        "loser_name": {
                            "type": "string",
                            "description": "Name of the tag to merge into the winner and delete"
                        },
                        "reason": {
                            "type": "string",
                            "description": "Brief explanation for why these tags should be merged"
                        }
                    },
                    "required": ["winner_name", "loser_name", "reason"],
                    "additionalProperties": false
                },
                "description": "List of tag pairs to merge"
            }
        },
        "required": ["merges"],
        "additionalProperties": false
    })
}

// ============================================================================
// HELPER FUNCTIONS (SYNC)
// ============================================================================

/// Get only top-level tags (parent_id IS NULL) as a newline-separated list
fn get_top_level_tags_for_llm(conn: &Connection) -> Result<String, String> {
    let mut stmt = conn
        .prepare("SELECT name FROM tags WHERE parent_id IS NULL ORDER BY name")
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let tags: Vec<String> = stmt
        .query_map([], |row| row.get(0))
        .map_err(|e| format!("Failed to query tags: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to collect tags: {}", e))?;

    if tags.is_empty() {
        return Ok("(no top-level tags)".to_string());
    }

    Ok(tags.join("\n"))
}

/// Check if `potential_child` is a descendant of `potential_parent`
/// Used to prevent circular references when moving tags
fn is_descendant_of(
    conn: &Connection,
    potential_child: &str,
    potential_parent: &str,
) -> Result<bool, String> {
    let mut current = potential_child.to_string();
    let mut visited = HashSet::new();

    loop {
        if current == potential_parent {
            return Ok(true);
        }
        if visited.contains(&current) {
            // Cycle detected in existing data - shouldn't happen but handle gracefully
            return Ok(false);
        }
        visited.insert(current.clone());

        let parent: Option<String> = conn
            .query_row(
                "SELECT parent_id FROM tags WHERE id = ?1",
                [&current],
                |row| row.get(0),
            )
            .ok()
            .and_then(|opt| opt);

        match parent {
            Some(p) => current = p,
            None => return Ok(false),
        }
    }
}

/// Look up a tag ID by name (case-insensitive)
fn get_tag_id_by_name(conn: &Connection, name: &str) -> Option<String> {
    conn.query_row(
        "SELECT id FROM tags WHERE LOWER(name) = LOWER(?1)",
        [name.trim()],
        |row| row.get(0),
    )
    .ok()
}

/// Get the current parent_id of a tag
fn get_tag_parent_id(conn: &Connection, tag_id: &str) -> Option<String> {
    conn.query_row(
        "SELECT parent_id FROM tags WHERE id = ?1",
        [tag_id],
        |row| row.get(0),
    )
    .ok()
    .and_then(|opt| opt)
}

// ============================================================================
// LLM CALLS (ASYNC)
// ============================================================================

/// Phase 1: Ask LLM for categorization suggestions
async fn get_categorization_suggestions(
    provider_config: &ProviderConfig,
    top_level_tags: &str,
    model: &str,
    supported_params: Option<Vec<String>>,
) -> Result<CategorizationResult, String> {
    let user_content = format!(
        "TOP-LEVEL TAGS (tags at the root of the hierarchy):\n{}\n\nAnalyze these tags and suggest which ones should be moved under other top-level tags to create a better hierarchy.",
        top_level_tags
    );

    let messages = vec![
        Message::system(CATEGORIZATION_SYSTEM_PROMPT),
        Message::user(user_content),
    ];

    let mut params = GenerationParams::new()
        .with_temperature(0.1)
        .with_structured_output(StructuredOutputSchema::new(
            "categorization_result",
            categorization_schema(),
        ))
        .with_minimize_reasoning(true);

    if let Some(supported) = supported_params {
        params = params.with_supported_parameters(supported);
    }

    let llm_config = LlmConfig::new(model).with_params(params);
    let provider = create_llm_provider(provider_config).map_err(|e| e.to_string())?;

    // Retry logic with exponential backoff
    let mut last_error = String::new();
    for attempt in 0..3 {
        if attempt > 0 {
            tokio::time::sleep(std::time::Duration::from_secs(1 << attempt)).await;
        }

        match provider.complete(&messages, &llm_config).await {
            Ok(response) => {
                let content = &response.content;
                if !content.is_empty() {
                    eprintln!("=== CATEGORIZATION LLM OUTPUT ===");
                    eprintln!("{}", content);
                    eprintln!("=================================");

                    let result: CategorizationResult = serde_json::from_str(content)
                        .map_err(|e| format!("Failed to parse categorization result: {} - Content: {}", e, content))?;
                    return Ok(result);
                }
                return Err("No content in response".to_string());
            }
            Err(e) => {
                let err_str = e.to_string();
                if e.is_retryable() {
                    last_error = err_str;
                    continue;
                } else {
                    last_error = err_str;
                    break;
                }
            }
        }
    }

    Err(last_error)
}

/// Phase 2: Ask LLM for merge suggestions
async fn get_merge_suggestions(
    provider_config: &ProviderConfig,
    tag_tree: &str,
    model: &str,
    supported_params: Option<Vec<String>>,
) -> Result<MergeResult, String> {
    let user_content = format!(
        "FULL TAG HIERARCHY:\n{}\n\nAnalyze this tag hierarchy and identify any tags that are duplicates or too similar and should be merged together.",
        tag_tree
    );

    let messages = vec![
        Message::system(MERGE_SYSTEM_PROMPT),
        Message::user(user_content),
    ];

    let mut params = GenerationParams::new()
        .with_temperature(0.1)
        .with_structured_output(StructuredOutputSchema::new("merge_result", merge_schema()))
        .with_minimize_reasoning(true);

    if let Some(supported) = supported_params {
        params = params.with_supported_parameters(supported);
    }

    let llm_config = LlmConfig::new(model).with_params(params);
    let provider = create_llm_provider(provider_config).map_err(|e| e.to_string())?;

    // Retry logic with exponential backoff
    let mut last_error = String::new();
    for attempt in 0..3 {
        if attempt > 0 {
            tokio::time::sleep(std::time::Duration::from_secs(1 << attempt)).await;
        }

        match provider.complete(&messages, &llm_config).await {
            Ok(response) => {
                let content = &response.content;
                if !content.is_empty() {
                    eprintln!("=== MERGE LLM OUTPUT ===");
                    eprintln!("{}", content);
                    eprintln!("========================");

                    let result: MergeResult = serde_json::from_str(content)
                        .map_err(|e| format!("Failed to parse merge result: {} - Content: {}", e, content))?;
                    return Ok(result);
                }
                return Err("No content in response".to_string());
            }
            Err(e) => {
                let err_str = e.to_string();
                if e.is_retryable() {
                    last_error = err_str;
                    continue;
                } else {
                    last_error = err_str;
                    break;
                }
            }
        }
    }

    Err(last_error)
}

// ============================================================================
// DATABASE OPERATIONS (SYNC)
// ============================================================================

/// Execute a tag move (reparenting)
fn execute_tag_move(conn: &Connection, move_op: &TagMove) -> Result<bool, String> {
    // Look up tag and new parent by name
    let tag_id = match get_tag_id_by_name(conn, &move_op.tag_name) {
        Some(id) => id,
        None => {
            eprintln!(
                "Skipping move: tag '{}' not found",
                move_op.tag_name
            );
            return Ok(false);
        }
    };

    let parent_id = match get_tag_id_by_name(conn, &move_op.new_parent_name) {
        Some(id) => id,
        None => {
            eprintln!(
                "Skipping move: parent '{}' not found",
                move_op.new_parent_name
            );
            return Ok(false);
        }
    };

    // Check if tag is already under this parent
    let current_parent = get_tag_parent_id(conn, &tag_id);
    if current_parent.as_ref() == Some(&parent_id) {
        eprintln!(
            "Tag '{}' is already under '{}', skipping",
            move_op.tag_name, move_op.new_parent_name
        );
        return Ok(false);
    }

    // Prevent circular reference (don't move A under A's descendant)
    if is_descendant_of(conn, &parent_id, &tag_id)? {
        eprintln!(
            "Cannot move '{}' under '{}': would create circular reference",
            move_op.tag_name, move_op.new_parent_name
        );
        return Ok(false);
    }

    // Execute the move
    conn.execute(
        "UPDATE tags SET parent_id = ?1 WHERE id = ?2",
        rusqlite::params![&parent_id, &tag_id],
    )
    .map_err(|e| format!("Failed to move tag: {}", e))?;

    eprintln!(
        "Moved tag '{}' under '{}': {}",
        move_op.tag_name, move_op.new_parent_name, move_op.reason
    );

    Ok(true)
}

/// Execute a tag merge (loser -> winner)
/// Returns (success, atoms_retagged)
fn execute_tag_merge(conn: &Connection, merge: &TagMerge) -> Result<(bool, i32), String> {
    // Look up tags by name
    let winner_id = match get_tag_id_by_name(conn, &merge.winner_name) {
        Some(id) => id,
        None => {
            eprintln!("Skipping merge: winner '{}' not found", merge.winner_name);
            return Ok((false, 0));
        }
    };

    let loser_id = match get_tag_id_by_name(conn, &merge.loser_name) {
        Some(id) => id,
        None => {
            eprintln!("Skipping merge: loser '{}' not found", merge.loser_name);
            return Ok((false, 0));
        }
    };

    // Don't merge a tag with itself
    if winner_id == loser_id {
        eprintln!(
            "Skipping merge: '{}' and '{}' are the same tag",
            merge.winner_name, merge.loser_name
        );
        return Ok((false, 0));
    }

    // Don't merge if one is ancestor/descendant of the other
    if is_descendant_of(conn, &loser_id, &winner_id)? {
        eprintln!(
            "Skipping merge: '{}' is a descendant of '{}'",
            merge.loser_name, merge.winner_name
        );
        return Ok((false, 0));
    }
    if is_descendant_of(conn, &winner_id, &loser_id)? {
        eprintln!(
            "Skipping merge: '{}' is a descendant of '{}'",
            merge.winner_name, merge.loser_name
        );
        return Ok((false, 0));
    }

    // Get atoms tagged with the loser
    let atoms_with_loser: Vec<String> = {
        let mut stmt = conn
            .prepare("SELECT atom_id FROM atom_tags WHERE tag_id = ?1")
            .map_err(|e| format!("Failed to prepare query: {}", e))?;

        let results: Vec<String> = stmt
            .query_map([&loser_id], |row| row.get(0))
            .map_err(|e| format!("Failed to query atoms: {}", e))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to collect atoms: {}", e))?;

        results
    };

    // Retag atoms: add winner tag to each atom that had loser tag
    let mut atoms_retagged = 0;
    for atom_id in &atoms_with_loser {
        // Add winner tag (INSERT OR IGNORE to avoid duplicates)
        let inserted = conn
            .execute(
                "INSERT OR IGNORE INTO atom_tags (atom_id, tag_id) VALUES (?1, ?2)",
                rusqlite::params![atom_id, &winner_id],
            )
            .map_err(|e| format!("Failed to add winner tag: {}", e))?;

        if inserted > 0 {
            atoms_retagged += 1;
        }
    }

    // Move any child tags of loser to winner
    conn.execute(
        "UPDATE tags SET parent_id = ?1 WHERE parent_id = ?2",
        rusqlite::params![&winner_id, &loser_id],
    )
    .map_err(|e| format!("Failed to reparent children: {}", e))?;

    // Delete loser tag (CASCADE will remove atom_tags entries for loser)
    conn.execute(
        "DELETE FROM tags WHERE id = ?1",
        rusqlite::params![&loser_id],
    )
    .map_err(|e| format!("Failed to delete loser tag: {}", e))?;

    eprintln!(
        "Merged '{}' into '{}' ({} atoms retagged): {}",
        merge.loser_name, merge.winner_name, atoms_retagged, merge.reason
    );

    Ok((true, atoms_retagged))
}

/// Apply categorization moves to the database
fn apply_categorization_moves(conn: &Connection, moves: &[TagMove]) -> (i32, Vec<String>) {
    let mut tags_moved = 0;
    let mut errors = Vec::new();

    for move_op in moves {
        match execute_tag_move(conn, move_op) {
            Ok(true) => tags_moved += 1,
            Ok(false) => {} // Skipped, already logged
            Err(e) => errors.push(format!("Error moving '{}': {}", move_op.tag_name, e)),
        }
    }

    (tags_moved, errors)
}

/// Apply merges to the database
fn apply_merges(conn: &Connection, merges: &[TagMerge]) -> (i32, i32, Vec<String>) {
    let mut tags_merged = 0;
    let mut atoms_retagged = 0;
    let mut errors = Vec::new();

    for merge in merges {
        match execute_tag_merge(conn, merge) {
            Ok((true, retagged)) => {
                tags_merged += 1;
                atoms_retagged += retagged;
            }
            Ok((false, _)) => {} // Skipped, already logged
            Err(e) => errors.push(format!("Error merging '{}' -> '{}': {}", merge.loser_name, merge.winner_name, e)),
        }
    }

    (tags_merged, atoms_retagged, errors)
}

// ============================================================================
// PUBLIC SYNC FUNCTIONS (for use from commands.rs)
// ============================================================================

/// Read top-level tags for Phase 1 (sync, needs DB lock)
pub fn read_top_level_tags(conn: &Connection) -> Result<String, String> {
    get_top_level_tags_for_llm(conn)
}

/// Read full tag tree for Phase 2 (sync, needs DB lock)
pub fn read_tag_tree(conn: &Connection) -> Result<String, String> {
    get_tag_tree_for_llm(conn)
}

/// Apply categorization moves (sync, needs DB lock)
pub fn apply_moves(conn: &Connection, moves: &[TagMove]) -> (i32, Vec<String>) {
    apply_categorization_moves(conn, moves)
}

/// Apply merge operations (sync, needs DB lock)
pub fn apply_merge_operations(conn: &Connection, merges: &[TagMerge]) -> (i32, i32, Vec<String>) {
    apply_merges(conn, merges)
}

// ============================================================================
// PUBLIC ASYNC FUNCTIONS (for LLM calls, no DB access)
// ============================================================================

/// Phase 1: Get categorization suggestions from LLM (async, no DB)
pub async fn fetch_categorization_suggestions(
    provider_config: &ProviderConfig,
    top_level_tags: &str,
    model: &str,
    supported_params: Option<Vec<String>>,
) -> Result<CategorizationResult, String> {
    get_categorization_suggestions(provider_config, top_level_tags, model, supported_params).await
}

/// Phase 2: Get merge suggestions from LLM (async, no DB)
pub async fn fetch_merge_suggestions(
    provider_config: &ProviderConfig,
    tag_tree: &str,
    model: &str,
    supported_params: Option<Vec<String>>,
) -> Result<MergeResult, String> {
    get_merge_suggestions(provider_config, tag_tree, model, supported_params).await
}
