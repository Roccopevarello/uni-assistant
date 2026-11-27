export interface Profile {
  user_id: string;
  time_zone: string;
  briefing_hour: number;
  courses: string[];
  ai_provider: "anthropic" | "openai" | null;
  ai_model: string | null;
  ai_key_hint: string | null;
  has_blackboard_feed: boolean;
  calendar_token: string;
  last_mail_check: string | null;
  last_run_date: string | null;
  last_run_error: string | null;
  pending_questions: string[];
}

export interface Mailbox {
  provider: "microsoft" | "google";
  email: string;
  connected_at: string;
}

export interface DeadlineRow {
  id: string;
  course: string;
  task: string;
  action: string;
  due_date: string;
  due_time: string | null;
  source: "email" | "blackboard";
}

export interface BriefingRow {
  run_date: string;
  headline: string;
  overview: string[];
  today: string[];
  new_since_yesterday: string[];
  watch_out: string[];
  created_at: string;
}

export const PROFILE_COLUMNS =
  "user_id, time_zone, briefing_hour, courses, ai_provider, ai_model, ai_key_hint, has_blackboard_feed, calendar_token, last_mail_check, last_run_date, last_run_error, pending_questions";
