mock_provider "google" {}

variables { project_id = "synthetic-idea-map-staging" }

run "isolated_disposable_database" {
  command = plan
  assert {
    condition     = google_sql_database_instance.staging.database_version == "POSTGRES_17" && google_sql_database_instance.staging.settings[0].connector_enforcement == "REQUIRED"
    error_message = "The test database must require authenticated Cloud SQL connectors."
  }
  assert {
    condition     = google_sql_database_instance.staging.settings[0].tier == "db-f1-micro" && !google_sql_database_instance.staging.settings[0].disk_autoresize
    error_message = "The disposable database must retain bounded sizing."
  }
  assert {
    condition     = google_sql_database_instance.staging.deletion_protection && google_sql_database_instance.staging.settings[0].deletion_protection_enabled
    error_message = "Both Terraform and Cloud SQL deletion protection must be enabled."
  }
}
