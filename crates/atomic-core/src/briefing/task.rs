//! Daily briefing scheduled task.
//!
//! Wraps [`super::run_briefing`] in the [`ScheduledTask`] trait so the
//! scheduler loop can drive it on a calendar schedule. State lives in the
//! per-database settings table keyed under `task.daily_briefing.*`.

use super::schedule;
use crate::scheduler::{ScheduledTask, TaskContext, TaskError, TaskEvent};
use crate::AtomicCore;
use async_trait::async_trait;
use std::time::Duration;

/// The daily briefing task.
pub struct DailyBriefingTask;

const TASK_ID: &str = "daily_briefing";
const DEFAULT_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);

#[async_trait]
impl ScheduledTask for DailyBriefingTask {
    fn id(&self) -> &'static str {
        TASK_ID
    }

    fn display_name(&self) -> &'static str {
        "Daily briefing"
    }

    fn default_interval(&self) -> Duration {
        DEFAULT_INTERVAL
    }

    async fn run(&self, core: &AtomicCore, ctx: &TaskContext) -> Result<(), TaskError> {
        if !schedule::is_due(core).await? {
            return Err(TaskError::NotDue);
        }

        // Resolve the db_id for event reporting. For SQLite we use the file
        // stem; Postgres is not supported for briefings but the task ID is
        // still meaningful.
        let db_id = core
            .db_path()
            .file_stem()
            .and_then(|s| s.to_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| "default".to_string());

        (ctx.event_cb)(TaskEvent::Started {
            task_id: TASK_ID.to_string(),
            db_id: db_id.clone(),
        });

        // Delegate to `run_daily_briefing` so the scheduler tick contends for
        // the same single-flight lock as the HTTP route. `run_daily_briefing`
        // also computes `since` from the persisted `last_run` (same 7-day
        // first-run lookback) and persists a fresh `last_run` on success.
        match core.run_daily_briefing().await {
            Ok(result) => {
                // `result` is None when the window had no new atoms; we still
                // emit Completed so the scheduler records a clean run, but
                // there's no briefing id to surface.
                (ctx.event_cb)(TaskEvent::Completed {
                    task_id: TASK_ID.to_string(),
                    db_id,
                    result_id: result.as_ref().map(|r| r.briefing.id.clone()),
                });
                Ok(())
            }
            Err(e) => {
                let msg = e.to_string();
                (ctx.event_cb)(TaskEvent::Failed {
                    task_id: TASK_ID.to_string(),
                    db_id,
                    error: msg.clone(),
                });
                Err(TaskError::Other(msg))
            }
        }
    }
}
