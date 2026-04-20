//! Log export endpoint

use crate::state::AppState;
use actix_web::{web, HttpResponse};

/// Return recent log lines from the in-memory ring buffer.
pub async fn get_logs(state: web::Data<AppState>) -> HttpResponse {
    let logs = state.log_buffer.dump();
    HttpResponse::Ok().json(serde_json::json!({ "logs": logs }))
}
