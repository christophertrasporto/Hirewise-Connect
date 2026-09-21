-- INV-I3: AuditLog is append-only. Reject UPDATE and DELETE at the database level
-- so no application path, migration, or ad-hoc SQL can rewrite history.
CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_no_update ON "AuditLog";
CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();

DROP TRIGGER IF EXISTS audit_log_no_delete ON "AuditLog";
CREATE TRIGGER audit_log_no_delete
  BEFORE DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();

-- Also block TRUNCATE outside test databases. Tests truncate tables between files,
-- so this statement-level trigger is only installed when the database is not named *_test.
DO $$
BEGIN
  IF current_database() NOT LIKE '%_test' THEN
    EXECUTE 'DROP TRIGGER IF EXISTS audit_log_no_truncate ON "AuditLog"';
    EXECUTE 'CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON "AuditLog" FOR EACH STATEMENT EXECUTE FUNCTION audit_log_append_only()';
  END IF;
END $$;

-- Section 5.8: only one ACTIVE (or EXTENDED) reservation per agent at a time.
CREATE UNIQUE INDEX IF NOT EXISTS "Reservation_one_active_per_agent"
  ON "Reservation" ("agentProfileId")
  WHERE "status" IN ('ACTIVE', 'EXTENDED');
