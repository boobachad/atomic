//! Calendar-aware schedule for the briefing task.
//!
//! Briefing cadence is task state, not generic application settings. These
//! helpers intentionally read and write the active data DB's `settings` table
//! directly so every database can keep an independent schedule.

use crate::error::AtomicCoreError;
use crate::scheduler;
use crate::AtomicCore;
use chrono::{
    DateTime, Datelike, Duration as ChronoDuration, LocalResult, NaiveDate, NaiveDateTime,
    NaiveTime, TimeZone, Utc, Weekday,
};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const TASK_ID: &str = "daily_briefing";
const DEFAULT_TIME: &str = "09:00";
const DEFAULT_TIMEZONE: &str = "UTC";

const FREQUENCY_KEY: &str = "task.daily_briefing.frequency";
const TIME_KEY: &str = "task.daily_briefing.time";
const LEGACY_TIMEZONE_KEY: &str = "task.daily_briefing.timezone";
const WEEKDAY_KEY: &str = "task.daily_briefing.weekday";
const SCHEDULE_UPDATED_AT_KEY: &str = "task.daily_briefing.schedule_updated_at";
const LEGACY_ENABLED_KEY: &str = "task.daily_briefing.enabled";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum BriefingFrequency {
    Off,
    Daily,
    Weekly,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum BriefingWeekday {
    Monday,
    Tuesday,
    Wednesday,
    Thursday,
    Friday,
    Saturday,
    Sunday,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct BriefingSchedule {
    pub frequency: BriefingFrequency,
    /// Local wall-clock time in 24-hour `HH:MM` form.
    pub time: String,
    /// Required for weekly schedules. Ignored for daily/off.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub weekday: Option<BriefingWeekday>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct BriefingScheduleStatus {
    pub schedule: BriefingSchedule,
    /// Workspace timezone used to compute `next_run_at`.
    pub timezone: String,
    pub last_run_at: Option<String>,
    pub next_run_at: Option<String>,
    /// True once the active DB has a saved calendar schedule. False means the
    /// response is using legacy/default values.
    pub configured: bool,
}

#[derive(Debug, Clone)]
struct EffectiveSchedule {
    schedule: BriefingSchedule,
    timezone: String,
    configured: bool,
    updated_at: Option<DateTime<Utc>>,
}

pub async fn get_schedule_status(
    core: &AtomicCore,
) -> Result<BriefingScheduleStatus, AtomicCoreError> {
    let effective = read_effective_schedule(core).await?;
    let last_run = scheduler::state::get_last_run(core, TASK_ID).await?;
    let next_run = next_scheduled_after(&effective.schedule, &effective.timezone, Utc::now())?;
    Ok(BriefingScheduleStatus {
        schedule: effective.schedule,
        timezone: effective.timezone,
        last_run_at: last_run.map(|dt| dt.to_rfc3339()),
        next_run_at: next_run.map(|dt| dt.to_rfc3339()),
        configured: effective.configured,
    })
}

pub async fn set_schedule(
    core: &AtomicCore,
    schedule: BriefingSchedule,
) -> Result<BriefingScheduleStatus, AtomicCoreError> {
    let normalized = normalize_schedule(schedule)?;
    let storage = core.storage();
    storage
        .set_setting_sync(FREQUENCY_KEY, frequency_str(normalized.frequency))
        .await?;
    storage.set_setting_sync(TIME_KEY, &normalized.time).await?;
    storage.delete_setting_sync(LEGACY_TIMEZONE_KEY).await?;

    if let Some(weekday) = normalized.weekday {
        storage
            .set_setting_sync(WEEKDAY_KEY, weekday_str(weekday))
            .await?;
    } else {
        storage.delete_setting_sync(WEEKDAY_KEY).await?;
    }

    // Preserve compatibility with older builds that only understand
    // task.daily_briefing.enabled.
    storage
        .set_setting_sync(
            LEGACY_ENABLED_KEY,
            if normalized.frequency == BriefingFrequency::Off {
                "false"
            } else {
                "true"
            },
        )
        .await?;
    storage
        .set_setting_sync(SCHEDULE_UPDATED_AT_KEY, &Utc::now().to_rfc3339())
        .await?;

    get_schedule_status(core).await
}

pub async fn is_due(core: &AtomicCore) -> Result<bool, AtomicCoreError> {
    let effective = read_effective_schedule(core).await?;
    if effective.schedule.frequency == BriefingFrequency::Off {
        return Ok(false);
    }

    let Some(latest) =
        latest_scheduled_at_or_before(&effective.schedule, &effective.timezone, Utc::now())?
    else {
        return Ok(false);
    };

    if let Some(updated_at) = effective.updated_at {
        if latest <= updated_at {
            return Ok(false);
        }
    }

    match scheduler::state::get_last_run(core, TASK_ID).await? {
        Some(last_run) => Ok(last_run < latest),
        None => Ok(true),
    }
}

async fn read_effective_schedule(core: &AtomicCore) -> Result<EffectiveSchedule, AtomicCoreError> {
    let settings = core.storage().get_all_settings_sync().await?;
    let configured = settings.contains_key(FREQUENCY_KEY);

    let frequency = settings
        .get(FREQUENCY_KEY)
        .map(|raw| parse_frequency(raw))
        .transpose()?
        .unwrap_or_else(|| legacy_frequency(&settings));

    let time = settings
        .get(TIME_KEY)
        .cloned()
        .unwrap_or_else(|| DEFAULT_TIME.to_string());
    let weekday = settings
        .get(WEEKDAY_KEY)
        .map(|raw| parse_weekday(raw))
        .transpose()?
        .or_else(|| {
            if frequency == BriefingFrequency::Weekly {
                Some(BriefingWeekday::Monday)
            } else {
                None
            }
        });

    let schedule = normalize_schedule(BriefingSchedule {
        frequency,
        time,
        weekday,
    })?;
    let timezone = workspace_timezone(core).await?;

    let updated_at = settings
        .get(SCHEDULE_UPDATED_AT_KEY)
        .and_then(|raw| DateTime::parse_from_rfc3339(raw).ok())
        .map(|dt| dt.with_timezone(&Utc));

    Ok(EffectiveSchedule {
        schedule,
        timezone,
        configured,
        updated_at,
    })
}

fn normalize_schedule(mut schedule: BriefingSchedule) -> Result<BriefingSchedule, AtomicCoreError> {
    let time = parse_time(&schedule.time)?;
    schedule.time = time.format("%H:%M").to_string();

    match schedule.frequency {
        BriefingFrequency::Weekly => {
            if schedule.weekday.is_none() {
                return Err(AtomicCoreError::Validation(
                    "Weekly briefing schedules require a weekday".to_string(),
                ));
            }
        }
        BriefingFrequency::Daily | BriefingFrequency::Off => {
            schedule.weekday = None;
        }
    }

    Ok(schedule)
}

fn legacy_frequency(settings: &HashMap<String, String>) -> BriefingFrequency {
    match settings.get(LEGACY_ENABLED_KEY) {
        Some(value)
            if matches!(
                value.to_ascii_lowercase().as_str(),
                "false" | "0" | "no" | "off"
            ) =>
        {
            BriefingFrequency::Off
        }
        _ => BriefingFrequency::Daily,
    }
}

fn parse_frequency(raw: &str) -> Result<BriefingFrequency, AtomicCoreError> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "off" => Ok(BriefingFrequency::Off),
        "daily" => Ok(BriefingFrequency::Daily),
        "weekly" => Ok(BriefingFrequency::Weekly),
        other => Err(AtomicCoreError::Validation(format!(
            "Invalid briefing frequency '{}'",
            other
        ))),
    }
}

fn frequency_str(frequency: BriefingFrequency) -> &'static str {
    match frequency {
        BriefingFrequency::Off => "off",
        BriefingFrequency::Daily => "daily",
        BriefingFrequency::Weekly => "weekly",
    }
}

fn parse_weekday(raw: &str) -> Result<BriefingWeekday, AtomicCoreError> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "monday" | "mon" => Ok(BriefingWeekday::Monday),
        "tuesday" | "tue" | "tues" => Ok(BriefingWeekday::Tuesday),
        "wednesday" | "wed" => Ok(BriefingWeekday::Wednesday),
        "thursday" | "thu" | "thurs" => Ok(BriefingWeekday::Thursday),
        "friday" | "fri" => Ok(BriefingWeekday::Friday),
        "saturday" | "sat" => Ok(BriefingWeekday::Saturday),
        "sunday" | "sun" => Ok(BriefingWeekday::Sunday),
        other => Err(AtomicCoreError::Validation(format!(
            "Invalid briefing weekday '{}'",
            other
        ))),
    }
}

fn weekday_str(weekday: BriefingWeekday) -> &'static str {
    match weekday {
        BriefingWeekday::Monday => "monday",
        BriefingWeekday::Tuesday => "tuesday",
        BriefingWeekday::Wednesday => "wednesday",
        BriefingWeekday::Thursday => "thursday",
        BriefingWeekday::Friday => "friday",
        BriefingWeekday::Saturday => "saturday",
        BriefingWeekday::Sunday => "sunday",
    }
}

fn chrono_weekday(weekday: BriefingWeekday) -> Weekday {
    match weekday {
        BriefingWeekday::Monday => Weekday::Mon,
        BriefingWeekday::Tuesday => Weekday::Tue,
        BriefingWeekday::Wednesday => Weekday::Wed,
        BriefingWeekday::Thursday => Weekday::Thu,
        BriefingWeekday::Friday => Weekday::Fri,
        BriefingWeekday::Saturday => Weekday::Sat,
        BriefingWeekday::Sunday => Weekday::Sun,
    }
}

fn parse_time(raw: &str) -> Result<NaiveTime, AtomicCoreError> {
    NaiveTime::parse_from_str(raw.trim(), "%H:%M").map_err(|_| {
        AtomicCoreError::Validation(format!(
            "Invalid briefing time '{}'; expected HH:MM in 24-hour time",
            raw
        ))
    })
}

fn parse_timezone(raw: &str) -> Result<Tz, AtomicCoreError> {
    raw.parse::<Tz>().map_err(|_| {
        AtomicCoreError::Validation(format!(
            "Invalid briefing timezone '{}'; expected an IANA timezone",
            raw
        ))
    })
}

async fn workspace_timezone(core: &AtomicCore) -> Result<String, AtomicCoreError> {
    let settings = core.get_settings().await?;
    let Some(timezone) = settings
        .get("timezone")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    else {
        return Ok(default_timezone());
    };
    match parse_timezone(timezone) {
        Ok(_) => Ok(timezone.to_string()),
        Err(e) => {
            tracing::warn!(
                value = %timezone,
                error = %e,
                "[briefing] Ignoring invalid workspace timezone"
            );
            Ok(default_timezone())
        }
    }
}

fn default_timezone() -> String {
    iana_time_zone::get_timezone().unwrap_or_else(|_| DEFAULT_TIMEZONE.to_string())
}

fn latest_scheduled_at_or_before(
    schedule: &BriefingSchedule,
    timezone: &str,
    now: DateTime<Utc>,
) -> Result<Option<DateTime<Utc>>, AtomicCoreError> {
    match schedule.frequency {
        BriefingFrequency::Off => Ok(None),
        BriefingFrequency::Daily => {
            let tz = parse_timezone(timezone)?;
            let time = parse_time(&schedule.time)?;
            let local_now = now.with_timezone(&tz);
            let today = local_now.date_naive();
            let candidate = local_candidate(tz, today, time)?;
            if candidate <= now {
                Ok(Some(candidate))
            } else {
                Ok(Some(local_candidate(
                    tz,
                    today - ChronoDuration::days(1),
                    time,
                )?))
            }
        }
        BriefingFrequency::Weekly => {
            let tz = parse_timezone(timezone)?;
            let time = parse_time(&schedule.time)?;
            let weekday = schedule.weekday.ok_or_else(|| {
                AtomicCoreError::Validation(
                    "Weekly briefing schedules require a weekday".to_string(),
                )
            })?;
            let local_now = now.with_timezone(&tz);
            let today = local_now.date_naive();
            let today_idx = local_now.weekday().num_days_from_monday() as i64;
            let target_idx = chrono_weekday(weekday).num_days_from_monday() as i64;
            let days_since = (today_idx - target_idx).rem_euclid(7);
            let mut date = today - ChronoDuration::days(days_since);
            let mut candidate = local_candidate(tz, date, time)?;
            if candidate > now {
                date -= ChronoDuration::days(7);
                candidate = local_candidate(tz, date, time)?;
            }
            Ok(Some(candidate))
        }
    }
}

fn next_scheduled_after(
    schedule: &BriefingSchedule,
    timezone: &str,
    now: DateTime<Utc>,
) -> Result<Option<DateTime<Utc>>, AtomicCoreError> {
    match schedule.frequency {
        BriefingFrequency::Off => Ok(None),
        BriefingFrequency::Daily => {
            let tz = parse_timezone(timezone)?;
            let time = parse_time(&schedule.time)?;
            let local_now = now.with_timezone(&tz);
            let today = local_now.date_naive();
            let candidate = local_candidate(tz, today, time)?;
            if candidate > now {
                Ok(Some(candidate))
            } else {
                Ok(Some(local_candidate(
                    tz,
                    today + ChronoDuration::days(1),
                    time,
                )?))
            }
        }
        BriefingFrequency::Weekly => {
            let tz = parse_timezone(timezone)?;
            let time = parse_time(&schedule.time)?;
            let weekday = schedule.weekday.ok_or_else(|| {
                AtomicCoreError::Validation(
                    "Weekly briefing schedules require a weekday".to_string(),
                )
            })?;
            let local_now = now.with_timezone(&tz);
            let today = local_now.date_naive();
            let today_idx = local_now.weekday().num_days_from_monday() as i64;
            let target_idx = chrono_weekday(weekday).num_days_from_monday() as i64;
            let days_until = (target_idx - today_idx).rem_euclid(7);
            let mut date = today + ChronoDuration::days(days_until);
            let mut candidate = local_candidate(tz, date, time)?;
            if candidate <= now {
                date += ChronoDuration::days(7);
                candidate = local_candidate(tz, date, time)?;
            }
            Ok(Some(candidate))
        }
    }
}

fn local_candidate(
    tz: Tz,
    date: NaiveDate,
    time: NaiveTime,
) -> Result<DateTime<Utc>, AtomicCoreError> {
    resolve_local(tz, date.and_time(time)).map(|dt| dt.with_timezone(&Utc))
}

fn resolve_local(tz: Tz, local: NaiveDateTime) -> Result<DateTime<Tz>, AtomicCoreError> {
    match tz.from_local_datetime(&local) {
        LocalResult::Single(dt) => Ok(dt),
        // Pick the first occurrence on fall-back transitions so one scheduled
        // wall-clock time cannot generate two briefings.
        LocalResult::Ambiguous(first, _) => Ok(first),
        // For spring-forward gaps, advance to the first valid local minute.
        LocalResult::None => {
            for minutes in 1..=180 {
                let shifted = local + ChronoDuration::minutes(minutes);
                match tz.from_local_datetime(&shifted) {
                    LocalResult::Single(dt) => return Ok(dt),
                    LocalResult::Ambiguous(first, _) => return Ok(first),
                    LocalResult::None => {}
                }
            }
            Err(AtomicCoreError::Validation(format!(
                "Could not resolve scheduled local time '{}' in timezone '{}'",
                local, tz
            )))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn utc(raw: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(raw)
            .unwrap()
            .with_timezone(&Utc)
    }

    fn daily(time: &str) -> BriefingSchedule {
        BriefingSchedule {
            frequency: BriefingFrequency::Daily,
            time: time.to_string(),
            weekday: None,
        }
    }

    fn weekly(time: &str, weekday: BriefingWeekday) -> BriefingSchedule {
        BriefingSchedule {
            frequency: BriefingFrequency::Weekly,
            time: time.to_string(),
            weekday: Some(weekday),
        }
    }

    #[test]
    fn daily_next_run_waits_until_today_when_before_time() {
        let next = next_scheduled_after(&daily("09:00"), "UTC", utc("2026-05-12T08:00:00Z"))
            .unwrap()
            .unwrap();
        assert_eq!(next, utc("2026-05-12T09:00:00Z"));
    }

    #[test]
    fn daily_next_run_rolls_to_tomorrow_after_time() {
        let next = next_scheduled_after(&daily("09:00"), "UTC", utc("2026-05-12T10:00:00Z"))
            .unwrap()
            .unwrap();
        assert_eq!(next, utc("2026-05-13T09:00:00Z"));
    }

    #[test]
    fn weekly_next_run_uses_configured_weekday() {
        let next = next_scheduled_after(
            &weekly("09:00", BriefingWeekday::Friday),
            "UTC",
            utc("2026-05-12T10:00:00Z"),
        )
        .unwrap()
        .unwrap();
        assert_eq!(next, utc("2026-05-15T09:00:00Z"));
    }

    #[test]
    fn timezone_schedule_converts_to_utc() {
        let next = next_scheduled_after(
            &daily("09:00"),
            "America/New_York",
            utc("2026-05-12T12:00:00Z"),
        )
        .unwrap()
        .unwrap();
        assert_eq!(next, utc("2026-05-12T13:00:00Z"));
    }

    #[test]
    fn off_schedule_has_no_next_run() {
        let next = next_scheduled_after(
            &BriefingSchedule {
                frequency: BriefingFrequency::Off,
                time: "09:00".to_string(),
                weekday: None,
            },
            "UTC",
            utc("2026-05-12T12:00:00Z"),
        )
        .unwrap();
        assert!(next.is_none());
    }
}
