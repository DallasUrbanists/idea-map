mock_provider "google" {
  override_during = plan
}

variables {
  project_id = "dallasurbanists-idea-map-dev"
}

run "separate_synthetic_database" {
  command = plan
  assert {
    condition     = google_sql_database_instance.worker.name == "idea-map-worker-synthetic" && google_sql_database.worker.name == "idea_map_test_worker" && google_sql_database.worker.instance == "idea-map-worker-synthetic"
    error_message = "The worker database must be separate from SSR staging."
  }
  assert {
    condition     = google_sql_database_instance.worker.deletion_protection && google_sql_database_instance.worker.settings[0].deletion_protection_enabled && google_sql_database_instance.worker.settings[0].connector_enforcement == "REQUIRED" && !google_sql_database_instance.worker.settings[0].backup_configuration[0].enabled && google_sql_database.worker.deletion_policy == "PREVENT"
    error_message = "The disposable database must require connectors and guard deletion."
  }
}

run "reject_other_projects" {
  command = plan
  variables { project_id = "synthetic-production" }
  expect_failures = [var.project_id]
}
