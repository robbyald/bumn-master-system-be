UPDATE latsol_progress
SET attempts = CASE WHEN attempts = 0 THEN 1 ELSE attempts END,
    last_attempt_at = COALESCE(last_attempt_at, completed_at);
