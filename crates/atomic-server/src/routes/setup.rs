//! Instance setup endpoint — allows claiming an unconfigured instance

use crate::state::AppState;
use actix_web::{web, HttpResponse};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Serialize, ToSchema)]
pub struct SetupStatusResponse {
    pub needs_setup: bool,
}

#[utoipa::path(
    get,
    path = "/api/setup/status",
    responses(
        (status = 200, description = "Whether the instance needs initial setup", body = SetupStatusResponse)
    ),
    tag = "setup",
    security(())
)]
pub async fn setup_status(state: web::Data<AppState>) -> HttpResponse {
    let core = match state.manager.active_core().await {
        Ok(c) => c,
        Err(e) => return crate::error::error_response(e),
    };
    match core.list_api_tokens().await {
        Ok(tokens) => {
            let active = tokens.iter().filter(|t| !t.is_revoked).count();
            HttpResponse::Ok().json(SetupStatusResponse {
                needs_setup: active == 0,
            })
        }
        Err(e) => crate::error::error_response(e),
    }
}

#[derive(Deserialize, ToSchema)]
pub struct ClaimBody {
    pub name: Option<String>,
}

#[derive(Serialize, ToSchema)]
pub struct ClaimResponse {
    pub id: String,
    pub name: String,
    pub token: String,
    pub prefix: String,
    pub created_at: String,
}

#[utoipa::path(
    post,
    path = "/api/setup/claim",
    request_body = ClaimBody,
    responses(
        (status = 201, description = "Instance claimed and first token created", body = ClaimResponse),
        (status = 409, description = "Instance already has an active token")
    ),
    tag = "setup",
    security(())
)]
pub async fn claim_instance(
    state: web::Data<AppState>,
    body: web::Json<ClaimBody>,
) -> HttpResponse {
    let name = body
        .into_inner()
        .name
        .unwrap_or_else(|| "default".to_string());
    let core = match state.manager.active_core().await {
        Ok(c) => c,
        Err(e) => return crate::error::error_response(e),
    };

    // Check that no active tokens exist
    let tokens = match core.list_api_tokens().await {
        Ok(t) => t,
        Err(e) => return crate::error::error_response(e),
    };
    let active = tokens.iter().filter(|t| !t.is_revoked).count();
    if active > 0 {
        return HttpResponse::Conflict().json(serde_json::json!({
            "error": "Instance already claimed"
        }));
    }
    match core.create_api_token(&name).await {
        Ok((info, raw_token)) => HttpResponse::Created().json(ClaimResponse {
            id: info.id,
            name: info.name,
            token: raw_token,
            prefix: info.token_prefix,
            created_at: info.created_at,
        }),
        Err(e) => crate::error::error_response(e),
    }
}
