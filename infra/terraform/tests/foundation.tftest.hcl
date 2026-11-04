mock_provider "google" {
  override_during = plan
}

variables {
  project_id  = "synthetic-idea-map-dev"
  environment = "dev"
  bucket_names = {
    uploads = "synthetic-idea-map-dev-uploads"
    public  = "synthetic-idea-map-dev-public"
    backups = "synthetic-idea-map-dev-backups"
  }
  web_image    = "example.invalid/web@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  worker_image = "example.invalid/worker@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
}

run "bounded_private_foundation" {
  command = plan
  assert {
    condition     = alltrue([for service in google_cloud_run_v2_service.runtime : service.scaling[0].min_instance_count == 0 && service.template[0].scaling[0].min_instance_count == 0])
    error_message = "Services and revisions must both scale to zero."
  }
  assert {
    condition     = google_cloud_run_v2_service.runtime["web"].template[0].scaling[0].max_instance_count == 2 && google_cloud_run_v2_service.runtime["worker"].template[0].scaling[0].max_instance_count == 1
    error_message = "Web and worker instance maxima must remain bounded."
  }
  assert {
    condition     = google_cloud_run_v2_service.runtime["web"].ingress == "INGRESS_TRAFFIC_INTERNAL_ONLY" && google_cloud_run_v2_service.runtime["worker"].ingress == "INGRESS_TRAFFIC_INTERNAL_ONLY"
    error_message = "Services must remain private pending reviewed ingress and IAM."
  }
  assert {
    condition     = alltrue([for bucket in google_storage_bucket.media : bucket.public_access_prevention == "enforced" && bucket.force_destroy == false])
    error_message = "All buckets must prevent public access and forced deletion."
  }
}

run "public_uptime_is_opt_in" {
  command = plan
  assert {
    condition     = length(google_monitoring_uptime_check_config.public_health) == 0 && length(google_monitoring_alert_policy.public_health) == 0
    error_message = "Public availability checks and alerts must not be created by default."
  }
}

run "public_uptime_uses_reviewed_https_target" {
  command = plan
  variables {
    enable_public_uptime_check = true
    public_uptime_hostname     = "staging.synthetic.invalid"
  }
  assert {
    condition = google_monitoring_uptime_check_config.public_health[0].monitored_resource[0].labels.host == "staging.synthetic.invalid" && (
      google_monitoring_uptime_check_config.public_health[0].http_check[0].path == "/api/health" &&
      google_monitoring_uptime_check_config.public_health[0].http_check[0].use_ssl &&
      google_monitoring_uptime_check_config.public_health[0].http_check[0].validate_ssl &&
      google_monitoring_uptime_check_config.public_health[0].http_check[0].port == 443 &&
      google_monitoring_uptime_check_config.public_health[0].content_matchers[0].matcher == "MATCHES_JSON_PATH"
    )
    error_message = "The uptime check must use the reviewed hostname and verified HTTPS health endpoint."
  }
  assert {
    condition = google_monitoring_uptime_check_config.public_health[0].content_matchers[0].content == "\"ok\"" && (
      google_monitoring_uptime_check_config.public_health[0].content_matchers[0].json_path_matcher[0].json_path == "$.status" &&
      google_monitoring_uptime_check_config.public_health[0].content_matchers[0].json_path_matcher[0].json_matcher == "EXACT_MATCH"
    )
    error_message = "The check must match the exact JSON status field."
  }
}

run "public_alert_uses_existing_channels_and_exact_check" {
  command = plan
  variables {
    enable_public_uptime_check       = true
    enable_public_uptime_alert       = true
    public_uptime_hostname           = "staging.synthetic.invalid"
    monitoring_notification_channels = ["projects/synthetic-idea-map-dev/notificationChannels/123"]
  }
  override_resource {
    target          = google_monitoring_uptime_check_config.public_health[0]
    override_during = plan
    values          = { uptime_check_id = "synthetic-check" }
  }
  assert {
    condition = toset(google_monitoring_alert_policy.public_health[0].notification_channels) == toset(["projects/synthetic-idea-map-dev/notificationChannels/123"]) && alltrue([
      for condition in google_monitoring_alert_policy.public_health[0].conditions :
      strcontains(condition.condition_threshold[0].filter, "synthetic-check")
    ])
    error_message = "The alert must target its own uptime check and use the reviewed existing channel."
  }
  assert {
    condition = length([for condition in google_monitoring_alert_policy.public_health[0].conditions : condition if(
      try(condition.condition_threshold[0].threshold_value, null) == 1 &&
      try(condition.condition_threshold[0].duration, null) == "600s" &&
      try(condition.condition_threshold[0].aggregations[0].cross_series_reducer, null) == "REDUCE_COUNT_FALSE"
    )]) == 1
    error_message = "The alert must detect multiple sustained checker failures."
  }
}

run "public_alert_requires_check_and_channel" {
  command = plan
  variables { enable_public_uptime_alert = true }
  expect_failures = [var.enable_public_uptime_alert]
}

run "public_alert_rejects_other_project_channel" {
  command = plan
  variables { monitoring_notification_channels = ["projects/other/notificationChannels/123"] }
  expect_failures = [var.monitoring_notification_channels]
}

run "public_uptime_requires_hostname" {
  command = plan
  variables { enable_public_uptime_check = true }
  expect_failures = [google_monitoring_uptime_check_config.public_health]
}

run "public_uptime_rejects_url" {
  command = plan
  variables { public_uptime_hostname = "https://staging.synthetic.invalid/path" }
  expect_failures = [var.public_uptime_hostname]
}

run "storage_capacity_alerts_are_opt_in" {
  command = plan
  assert {
    condition     = length(google_monitoring_alert_policy.bucket_capacity) == 0
    error_message = "Storage capacity alerts must not be created by default."
  }
}

run "storage_capacity_alerts_are_scoped" {
  command = plan
  variables {
    enable_storage_capacity_alerts   = true
    monitoring_notification_channels = ["projects/synthetic-idea-map-dev/notificationChannels/123"]
    storage_capacity_threshold_bytes = { uploads = 1000, public = 2000, backups = 3000 }
  }
  assert {
    condition = length(google_monitoring_alert_policy.bucket_capacity) == 3 && alltrue([
      for key, policy in google_monitoring_alert_policy.bucket_capacity :
      one(policy.conditions).condition_threshold[0].filter == "metric.type=\"storage.googleapis.com/storage/v2/total_bytes\" AND resource.type=\"gcs_bucket\" AND resource.label.bucket_name=\"${var.bucket_names[key]}\"" &&
      one(policy.conditions).condition_threshold[0].threshold_value == var.storage_capacity_threshold_bytes[key] &&
      one(policy.conditions).condition_threshold[0].aggregations[0].cross_series_reducer == "REDUCE_SUM" &&
      toset(policy.notification_channels) == toset(var.monitoring_notification_channels)
    ])
    error_message = "Each storage alert must use its exact bucket, reviewed threshold, and existing notification channel."
  }
}

run "storage_capacity_alerts_require_reviewed_inputs" {
  command = plan
  variables { enable_storage_capacity_alerts = true }
  expect_failures = [var.enable_storage_capacity_alerts]
}

run "storage_capacity_alerts_reject_invalid_threshold" {
  command = plan
  variables { storage_capacity_threshold_bytes = { backups = -1 } }
  expect_failures = [var.storage_capacity_threshold_bytes]
}

run "storage_alerts_reject_unmanaged_buckets" {
  command = plan
  variables {
    manage_media_buckets             = false
    enable_storage_capacity_alerts   = true
    monitoring_notification_channels = ["projects/synthetic-idea-map-dev/notificationChannels/123"]
    storage_capacity_threshold_bytes = { uploads = 1000, public = 2000, backups = 3000 }
  }
  expect_failures = [var.enable_storage_capacity_alerts]
}

run "storage_growth_alerts_are_opt_in" {
  command = plan
  assert {
    condition     = length(google_monitoring_alert_policy.bucket_growth) == 0
    error_message = "Storage growth alerts must not be created by default."
  }
}

run "storage_growth_alerts_are_scoped" {
  command = plan
  variables {
    enable_storage_growth_alerts     = true
    monitoring_notification_channels = ["projects/synthetic-idea-map-dev/notificationChannels/123"]
    storage_growth_threshold_percent = { uploads = 25, public = 30, backups = 40 }
  }
  assert {
    condition = length(google_monitoring_alert_policy.bucket_growth) == 3 && alltrue([
      for key, policy in google_monitoring_alert_policy.bucket_growth :
      one(policy.conditions).condition_threshold[0].filter == "metric.type=\"storage.googleapis.com/storage/v2/total_bytes\" AND resource.type=\"gcs_bucket\" AND resource.label.bucket_name=\"${var.bucket_names[key]}\"" &&
      one(policy.conditions).condition_threshold[0].threshold_value == var.storage_growth_threshold_percent[key] &&
      one(policy.conditions).condition_threshold[0].aggregations[0].alignment_period == "86400s" &&
      one(policy.conditions).condition_threshold[0].aggregations[0].per_series_aligner == "ALIGN_PERCENT_CHANGE" &&
      toset(policy.notification_channels) == toset(var.monitoring_notification_channels)
    ])
    error_message = "Each growth alert must use its exact bucket, reviewed percentage, and existing notification channel."
  }
}

run "storage_growth_alerts_require_reviewed_inputs" {
  command = plan
  variables { enable_storage_growth_alerts = true }
  expect_failures = [var.enable_storage_growth_alerts]
}

run "storage_growth_alerts_reject_invalid_threshold" {
  command = plan
  variables { storage_growth_threshold_percent = { backups = 0 } }
  expect_failures = [var.storage_growth_threshold_percent]
}

run "storage_growth_alerts_reject_unmanaged_buckets" {
  command = plan
  variables {
    manage_media_buckets             = false
    enable_storage_growth_alerts     = true
    monitoring_notification_channels = ["projects/synthetic-idea-map-dev/notificationChannels/123"]
    storage_growth_threshold_percent = { uploads = 25, public = 30, backups = 40 }
  }
  expect_failures = [var.enable_storage_growth_alerts]
}

run "queue_delay_alert_is_opt_in" {
  command = plan
  assert {
    condition     = length(google_monitoring_alert_policy.queue_delay) == 0
    error_message = "The queue delay alert must not be created by default."
  }
}

run "queue_delay_alert_uses_reviewed_queue_and_threshold" {
  command = plan
  variables {
    enable_queue_delay_alert         = true
    queue_delay_threshold_ms         = 120000
    monitoring_notification_channels = ["projects/synthetic-idea-map-dev/notificationChannels/123"]
  }
  assert {
    condition = one(google_monitoring_alert_policy.queue_delay[0].conditions).condition_threshold[0].filter == "resource.type=\"cloud_tasks_queue\" AND resource.labels.project_id=\"synthetic-idea-map-dev\" AND resource.labels.queue_id=\"idea-map-dev-queue\" AND metric.type=\"cloudtasks.googleapis.com/queue/task_attempt_delays\"" && (
      one(google_monitoring_alert_policy.queue_delay[0].conditions).condition_threshold[0].threshold_value == 120000 &&
      one(google_monitoring_alert_policy.queue_delay[0].conditions).condition_threshold[0].aggregations[0].per_series_aligner == "ALIGN_PERCENTILE_99" &&
      toset(google_monitoring_alert_policy.queue_delay[0].notification_channels) == toset(var.monitoring_notification_channels)
    )
    error_message = "The alert must use the reviewed project, queue, delay threshold, and existing channels."
  }
}

run "queue_delay_alert_requires_reviewed_inputs" {
  command = plan
  variables { enable_queue_delay_alert = true }
  expect_failures = [var.enable_queue_delay_alert]
}

run "queue_delay_alert_rejects_fractional_threshold" {
  command = plan
  variables { queue_delay_threshold_ms = 1.5 }
  expect_failures = [var.queue_delay_threshold_ms]
}

run "operations_monitor_is_opt_in" {
  command = plan
  assert {
    condition = length(google_cloud_run_v2_job.operations_monitor) == 0 && length(google_cloud_scheduler_job.operations_monitor) == 0 && (
      length(google_monitoring_alert_policy.operations_monitor) == 0 && length(google_service_account.operations_monitor) == 0 &&
      length(google_logging_metric.operations_heartbeat) == 0 && length(google_monitoring_alert_policy.operations_freshness) == 0
    )
    error_message = "Operations collection must not create resources by default."
  }
}

run "operations_monitor_uses_scoped_identity_and_paused_schedule" {
  command = plan
  variables {
    enable_operations_monitor          = true
    enable_operations_alert            = true
    enable_operations_freshness_alert  = true
    operations_monitor_image           = "us-central1-docker.pkg.dev/synthetic-idea-map-dev/images/worker@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
    operations_database_secret_id      = "synthetic-operations-only"
    operations_database_secret_version = "4"
    operations_monitor_schedule        = "*/5 * * * *"
    operations_thresholds              = { outbox_seconds = 300, overdue_seconds = 600, queue_seconds = 900, email_events = 2 }
    operations_database_capacity_bytes = "2000000000"
    monitoring_notification_channels   = ["projects/synthetic-idea-map-dev/notificationChannels/123"]
  }
  override_resource {
    target          = google_service_account.operations_monitor[0]
    override_during = plan
    values          = { email = "operations@synthetic.invalid" }
  }
  override_resource {
    target          = google_service_account.operations_scheduler[0]
    override_during = plan
    values          = { email = "operations-trigger@synthetic.invalid" }
  }
  assert {
    condition = toset(google_project_iam_custom_role.operations_queue_reader[0].permissions) == toset(["cloudtasks.tasks.list"]) && (
      google_cloud_tasks_queue_iam_member.operations_monitor[0].name == "idea-map-dev-queue" &&
      google_cloud_tasks_queue_iam_member.operations_monitor[0].member == "serviceAccount:operations@synthetic.invalid" &&
      google_secret_manager_secret_iam_member.operations_database[0].secret_id == "synthetic-operations-only"
    )
    error_message = "The collector must use its own identity, scoped queue listing, and dedicated secret."
  }
  assert {
    condition = google_cloud_run_v2_job.operations_monitor[0].template[0].task_count == 1 && (
      google_cloud_run_v2_job.operations_monitor[0].template[0].template[0].max_retries == 0 &&
      google_cloud_run_v2_job.operations_monitor[0].template[0].template[0].containers[0].command == tolist(["node", "dist/operations-monitor-cli.js"]) &&
      one([for entry in google_cloud_run_v2_job.operations_monitor[0].template[0].template[0].containers[0].env : entry.value if entry.name == "OPERATIONS_DATABASE_CAPACITY_BYTES"]) == "2000000000" &&
      google_cloud_scheduler_job.operations_monitor[0].paused &&
      google_cloud_scheduler_job.operations_monitor[0].http_target[0].oauth_token[0].service_account_email == "operations-trigger@synthetic.invalid" &&
      google_cloud_run_v2_job_iam_member.operations_scheduler[0].role == "roles/run.invoker"
    )
    error_message = "The collector must be bounded and its separate trigger must start paused."
  }
  assert {
    condition = strcontains(one(google_monitoring_alert_policy.operations_monitor[0].conditions).condition_matched_log[0].filter, "idea-map-ops-dev") && (
      strcontains(one(google_monitoring_alert_policy.operations_monitor[0].conditions).condition_matched_log[0].filter, "operations_collection_failed") &&
      strcontains(one(google_monitoring_alert_policy.operations_monitor[0].conditions).condition_matched_log[0].filter, "operations_threshold_breached") &&
      toset(google_monitoring_alert_policy.operations_monitor[0].notification_channels) == toset(var.monitoring_notification_channels)
    )
    error_message = "The alert must match only this collector's breach and failure events and use existing channels."
  }
  assert {
    condition = strcontains(google_logging_metric.operations_heartbeat[0].filter, "operations_assessment_completed") && (
      strcontains(one(google_monitoring_alert_policy.operations_freshness[0].conditions).condition_absent[0].filter, "idea-map-ops-heartbeat-dev") &&
      one(google_monitoring_alert_policy.operations_freshness[0].conditions).condition_absent[0].duration == "7200s" &&
      toset(google_monitoring_alert_policy.operations_freshness[0].notification_channels) == toset(var.monitoring_notification_channels)
    )
    error_message = "The freshness signal must track this collector's completed assessments and reviewed channels."
  }
}

run "operations_alert_requires_collector_and_channel" {
  command = plan
  variables { enable_operations_alert = true }
  expect_failures = [var.enable_operations_alert]
}

run "operations_freshness_requires_collector_and_channel" {
  command = plan
  variables { enable_operations_freshness_alert = true }
  expect_failures = [var.enable_operations_freshness_alert]
}

run "operations_monitor_requires_reviewed_inputs" {
  command = plan
  variables { enable_operations_monitor = true }
  expect_failures = [google_cloud_run_v2_job.operations_monitor]
}

run "operations_monitor_rejects_incomplete_thresholds" {
  command = plan
  variables { operations_thresholds = { queue_seconds = 60 } }
  expect_failures = [var.operations_thresholds]
}

run "operations_monitor_rejects_invalid_database_capacity" {
  command = plan
  variables { operations_database_capacity_bytes = "9223372036854775808" }
  expect_failures = [var.operations_database_capacity_bytes]
}

run "operations_monitor_requires_database_capacity" {
  command = plan
  variables {
    enable_operations_monitor          = true
    operations_monitor_image           = "us-central1-docker.pkg.dev/synthetic-idea-map-dev/images/worker@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
    operations_database_secret_id      = "synthetic-operations-only"
    operations_database_secret_version = "4"
    operations_monitor_schedule        = "*/5 * * * *"
    operations_thresholds              = { outbox_seconds = 300, overdue_seconds = 600, queue_seconds = 900, email_events = 2 }
  }
  expect_failures = [google_cloud_run_v2_job.operations_monitor]
}

run "operations_monitor_rejects_unpinned_secret" {
  command = plan
  variables { operations_database_secret_version = "latest" }
  expect_failures = [var.operations_database_secret_version]
}

run "operations_monitor_rejects_shared_worker_secret" {
  command = plan
  variables {
    enable_operations_monitor          = true
    operations_monitor_image           = "us-central1-docker.pkg.dev/synthetic-idea-map-dev/images/worker@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
    operations_database_secret_id      = "shared-secret"
    operations_database_secret_version = "4"
    operations_monitor_schedule        = "*/5 * * * *"
    operations_thresholds              = { outbox_seconds = 300, overdue_seconds = 600, queue_seconds = 900, email_events = 2 }
    operations_database_capacity_bytes = "2000000000"
    worker_database_secret_id          = "shared-secret"
  }
  expect_failures = [google_cloud_run_v2_job.operations_monitor]
}

run "operations_monitor_rejects_shared_web_secret" {
  command = plan
  variables {
    enable_operations_monitor          = true
    operations_monitor_image           = "us-central1-docker.pkg.dev/synthetic-idea-map-dev/images/worker@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
    operations_database_secret_id      = "shared-secret"
    operations_database_secret_version = "4"
    operations_monitor_schedule        = "*/5 * * * *"
    operations_thresholds              = { outbox_seconds = 300, overdue_seconds = 600, queue_seconds = 900, email_events = 2 }
    operations_database_capacity_bytes = "2000000000"
    web_database_secret_id             = "shared-secret"
    web_database_secret_version        = "1"
  }
  expect_failures = [google_cloud_run_v2_job.operations_monitor]
}

run "backup_job_is_opt_in" {
  command = plan
  assert {
    condition = length(google_cloud_run_v2_job.backup) == 0 && length(google_cloud_scheduler_job.backup) == 0 && (
      length(google_service_account.backup_writer) == 0 && length(google_project_iam_custom_role.backup_writer) == 0 &&
      length(google_monitoring_alert_policy.backup_failure) == 0 && length(google_logging_metric.backup_heartbeat) == 0 &&
      length(google_monitoring_alert_policy.backup_freshness) == 0
    )
    error_message = "Backup identities, job, and scheduler must not be created by default."
  }
}

run "backup_job_uses_create_only_access_and_paused_schedule" {
  command = plan
  variables {
    enable_backup_job                = true
    backup_job_image                 = "us-central1-docker.pkg.dev/synthetic-idea-map-dev/images/backup@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
    backup_project_number            = "123456789"
    backup_database_secret_id        = "synthetic-backup-only"
    backup_database_secret_version   = "7"
    backup_schedule                  = "0 */12 * * *"
    enable_backup_failure_alert      = true
    enable_backup_freshness_alert    = true
    backup_freshness_seconds         = 46800
    monitoring_notification_channels = ["projects/synthetic-idea-map-dev/notificationChannels/123"]
  }
  override_resource {
    target          = google_service_account.backup_writer[0]
    override_during = plan
    values          = { email = "backup-writer@synthetic.invalid" }
  }
  override_resource {
    target          = google_service_account.backup_scheduler[0]
    override_during = plan
    values          = { email = "backup-trigger@synthetic.invalid" }
  }
  assert {
    condition = toset(google_project_iam_custom_role.backup_writer[0].permissions) == toset(["storage.buckets.get", "storage.objects.create"]) && (
      google_storage_bucket_iam_member.backup_writer[0].bucket == var.bucket_names.backups &&
      google_storage_bucket_iam_member.backup_writer[0].member == "serviceAccount:backup-writer@synthetic.invalid" &&
      strcontains(google_storage_bucket_iam_member.backup_writer[0].condition[0].expression, "/idea-map-v2/dev/daily/") &&
      strcontains(google_storage_bucket_iam_member.backup_writer[0].condition[0].expression, "/idea-map-v2/dev/weekly/") &&
      strcontains(google_storage_bucket_iam_member.backup_writer[0].condition[0].expression, "/idea-map-v2/dev/completion/") &&
      !strcontains(google_storage_bucket_iam_member.backup_writer[0].condition[0].expression, "/recovery-journal/") &&
      google_secret_manager_secret_iam_member.backup_database[0].secret_id == "synthetic-backup-only"
    )
    error_message = "The backup writer must have create-only access to the existing bucket and its dedicated secret."
  }
  assert {
    condition = google_cloud_run_v2_job.backup[0].template[0].task_count == 1 && (
      google_cloud_run_v2_job.backup[0].template[0].parallelism == 1 &&
      google_cloud_run_v2_job.backup[0].template[0].template[0].max_retries == 0 &&
      google_cloud_run_v2_job.backup[0].template[0].template[0].timeout == "2100s" &&
      google_cloud_run_v2_job.backup[0].template[0].template[0].service_account == "backup-writer@synthetic.invalid"
      ) && anytrue([
        for entry in google_cloud_run_v2_job.backup[0].template[0].template[0].containers[0].env :
        entry.name == "BACKUP_DATABASE_URL" && try(entry.value_source[0].secret_key_ref[0].version, "") == "7"
    ])
    error_message = "The job must use one bounded task and the pinned backup-only secret."
  }
  assert {
    condition = google_cloud_scheduler_job.backup[0].paused && google_cloud_scheduler_job.backup[0].schedule == "0 */12 * * *" && (
      google_cloud_scheduler_job.backup[0].http_target[0].oauth_token[0].service_account_email == "backup-trigger@synthetic.invalid" &&
      strcontains(google_cloud_scheduler_job.backup[0].http_target[0].uri, "/jobs/idea-map-backup-dev:run") &&
      google_cloud_run_v2_job_iam_member.backup_scheduler[0].role == "roles/run.invoker"
    )
    error_message = "The reviewed scheduler must start paused and invoke only the backup job."
  }
  assert {
    condition = strcontains(one(google_monitoring_alert_policy.backup_failure[0].conditions).condition_matched_log[0].filter, "backup_export_failed") && (
      strcontains(google_logging_metric.backup_heartbeat[0].filter, "backup_export_completed") &&
      strcontains(one(google_monitoring_alert_policy.backup_freshness[0].conditions).condition_absent[0].filter, "idea-map-backup-heartbeat-dev") &&
      one(google_monitoring_alert_policy.backup_freshness[0].conditions).condition_absent[0].duration == "46800s" &&
      toset(google_monitoring_alert_policy.backup_failure[0].notification_channels) == toset(var.monitoring_notification_channels)
    )
    error_message = "Backup signals must watch the reviewed job's completed and failed exports using the existing channels."
  }
}

run "backup_alert_requires_job_and_channels" {
  command = plan
  variables { enable_backup_failure_alert = true }
  expect_failures = [var.enable_backup_failure_alert]
}

run "backup_freshness_requires_reviewed_window" {
  command = plan
  variables { enable_backup_freshness_alert = true }
  expect_failures = [var.enable_backup_freshness_alert]
}

run "backup_freshness_rejects_daily_schedule" {
  command = plan
  variables {
    enable_backup_job                = true
    enable_backup_freshness_alert    = true
    backup_job_image                 = "us-central1-docker.pkg.dev/synthetic-idea-map-dev/images/backup@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
    backup_project_number            = "123456789"
    backup_database_secret_id        = "synthetic-backup-db"
    backup_database_secret_version   = "1"
    backup_schedule                  = "0 0 * * *"
    backup_freshness_seconds         = 84600
    monitoring_notification_channels = ["projects/synthetic-idea-map-dev/notificationChannels/123"]
  }
  expect_failures = [var.enable_backup_freshness_alert]
}

run "backup_freshness_rejects_window_inside_job_timeout" {
  command = plan
  variables {
    enable_backup_job                = true
    enable_backup_freshness_alert    = true
    backup_job_image                 = "us-central1-docker.pkg.dev/synthetic-idea-map-dev/images/backup@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
    backup_project_number            = "123456789"
    backup_database_secret_id        = "synthetic-backup-db"
    backup_database_secret_version   = "1"
    backup_schedule                  = "0 */12 * * *"
    backup_freshness_seconds         = 45300
    monitoring_notification_channels = ["projects/synthetic-idea-map-dev/notificationChannels/123"]
  }
  expect_failures = [var.enable_backup_freshness_alert]
}
run "backup_freshness_rejects_invalid_window" {
  command = plan
  variables { backup_freshness_seconds = 85000 }
  expect_failures = [var.backup_freshness_seconds]
}

run "backup_job_rejects_mutable_image" {
  command = plan
  variables { backup_job_image = "us-central1-docker.pkg.dev/synthetic-idea-map-dev/images/backup:latest" }
  expect_failures = [var.backup_job_image]
}

run "backup_job_rejects_other_project_image" {
  command = plan
  variables { backup_job_image = "us-central1-docker.pkg.dev/other-project/images/backup@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" }
  expect_failures = [var.backup_job_image]
}

run "backup_job_rejects_unpinned_secret" {
  command = plan
  variables { backup_database_secret_version = "latest" }
  expect_failures = [var.backup_database_secret_version]
}

run "backup_job_rejects_weekly_only_schedule" {
  command = plan
  variables { backup_schedule = "0 0 * * 1" }
  expect_failures = [var.backup_schedule]
}

run "backup_job_rejects_shared_worker_secret" {
  command = plan
  variables {
    enable_backup_job              = true
    backup_job_image               = "us-central1-docker.pkg.dev/synthetic-idea-map-dev/images/backup@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
    backup_project_number          = "123456789"
    backup_database_secret_id      = "shared-secret"
    backup_database_secret_version = "7"
    backup_schedule                = "0 */12 * * *"
    worker_database_secret_id      = "shared-secret"
  }
  expect_failures = [google_cloud_run_v2_job.backup]
}

run "backup_job_rejects_shared_web_secret" {
  command = plan
  variables {
    enable_backup_job              = true
    backup_job_image               = "us-central1-docker.pkg.dev/synthetic-idea-map-dev/images/backup@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
    backup_project_number          = "123456789"
    backup_database_secret_id      = "shared-secret"
    backup_database_secret_version = "7"
    backup_schedule                = "0 */12 * * *"
    web_database_secret_id         = "shared-secret"
    web_database_secret_version    = "1"
  }
  expect_failures = [google_cloud_run_v2_job.backup]
}

run "backup_job_rejects_unmanaged_buckets" {
  command = plan
  variables {
    manage_media_buckets           = false
    enable_backup_job              = true
    backup_job_image               = "us-central1-docker.pkg.dev/synthetic-idea-map-dev/images/backup@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
    backup_project_number          = "123456789"
    backup_database_secret_id      = "backup-only"
    backup_database_secret_version = "7"
    backup_schedule                = "0 */12 * * *"
  }
  expect_failures = [google_cloud_run_v2_job.backup]
}

run "backup_job_can_use_backup_only_foundation" {
  command = plan
  variables {
    manage_media_buckets            = false
    manage_backup_bucket_separately = true
    enable_backup_job               = true
    backup_job_image                = "us-central1-docker.pkg.dev/synthetic-idea-map-dev/images/backup@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
    backup_project_number           = "123456789"
    backup_database_secret_id       = "backup-only"
    backup_database_secret_version  = "7"
    backup_schedule                 = "0 */12 * * *"
  }
  assert {
    condition = toset(keys(google_storage_bucket.media)) == toset(["backups"]) && (
      google_storage_bucket_iam_member.backup_writer[0].bucket == var.bucket_names.backups &&
      google_cloud_scheduler_job.backup[0].paused
    )
    error_message = "A backup-only foundation must use its own backup bucket and start the scheduler paused."
  }
}

run "backup_job_requires_explicit_inputs" {
  command = plan
  variables {
    enable_backup_job              = true
    backup_job_image               = "us-central1-docker.pkg.dev/synthetic-idea-map-dev/images/backup@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
    backup_project_number          = "123456789"
    backup_database_secret_id      = "synthetic-backup-only"
    backup_database_secret_version = "7"
  }
  expect_failures = [google_cloud_run_v2_job.backup]
}

run "task_delivery_is_opt_in" {
  command = plan
  assert {
    condition     = length(google_cloud_scheduler_job.repair) == 0 && length(google_service_account.task_invoker) == 0 && length(google_service_account.repair_invoker) == 0
    error_message = "Task identities and repair scheduling must be opt-in."
  }
}

run "task_delivery_is_scoped_and_paused" {
  command = plan
  variables { enable_task_delivery = true }
  override_resource {
    target          = google_cloud_run_v2_service.runtime["worker"]
    override_during = plan
    values          = { uri = "https://worker.synthetic.invalid" }
  }
  override_resource {
    target          = google_service_account.runtime["worker"]
    override_during = plan
    values          = { email = "worker@synthetic.invalid" }
  }
  override_resource {
    target          = google_service_account.task_invoker[0]
    override_during = plan
    values          = { email = "task-sa@synthetic-project.iam.gserviceaccount.com", name = "projects/synthetic-project/serviceAccounts/task-sa@synthetic-project.iam.gserviceaccount.com" }
  }
  override_resource {
    target          = google_service_account.repair_invoker[0]
    override_during = plan
    values          = { email = "repair@synthetic-project.iam.gserviceaccount.com" }
  }
  assert {
    condition     = google_cloud_scheduler_job.repair[0].paused && google_cloud_scheduler_job.repair[0].schedule == "0 * * * *" && google_cloud_scheduler_job.repair[0].http_target[0].oidc_token[0].audience == "https://worker.synthetic.invalid"
    error_message = "Hourly repair must start paused and target the worker audience."
  }
  assert {
    condition     = google_cloud_run_v2_service_iam_member.task_invoker[0].member == "serviceAccount:task-sa@synthetic-project.iam.gserviceaccount.com" && google_cloud_run_v2_service_iam_member.repair_invoker[0].member == "serviceAccount:repair@synthetic-project.iam.gserviceaccount.com" && google_cloud_tasks_queue_iam_member.worker_enqueue[0].role == "roles/cloudtasks.enqueuer"
    error_message = "Task and repair invokers must be distinct and queue access scoped."
  }
}

run "reject_invalid_environment" {
  command = plan
  variables { environment = "v1" }
  expect_failures = [var.environment]
}

run "reject_duplicate_buckets" {
  command = plan
  variables {
    bucket_names = { uploads = "same", public = "same", backups = "backup" }
  }
  expect_failures = [var.bucket_names]
}

run "resend_secrets_are_opt_in" {
  command = plan
  assert {
    condition     = length(google_secret_manager_secret.resend) == 0
    error_message = "Resend secrets must not be created without an explicit opt-in."
  }
  assert {
    condition     = length(google_secret_manager_secret_iam_member.resend) == 0
    error_message = "Resend secret grants must not be created without an explicit opt-in."
  }
}

run "resend_secrets_are_separate" {
  command = plan
  variables { enable_resend_secrets = true }
  override_resource {
    target          = google_service_account.runtime["web"]
    override_during = plan
    values          = { email = "web@synthetic.invalid" }
  }
  override_resource {
    target          = google_service_account.runtime["worker"]
    override_during = plan
    values          = { email = "worker@synthetic.invalid" }
  }
  assert {
    condition     = google_secret_manager_secret.resend["sending-key"].secret_id == "idea-map-dev-resend-sending-key" && google_secret_manager_secret.resend["webhook-secret"].secret_id == "idea-map-dev-resend-webhook-secret"
    error_message = "Sending and webhook credentials must have distinct environment-specific containers."
  }
  assert {
    condition     = google_secret_manager_secret_iam_member.resend["sending-key"].role == "roles/secretmanager.secretAccessor" && google_secret_manager_secret_iam_member.resend["webhook-secret"].role == "roles/secretmanager.secretAccessor" && google_secret_manager_secret_iam_member.resend["sending-key"].member == "serviceAccount:${google_service_account.runtime["worker"].email}" && google_secret_manager_secret_iam_member.resend["webhook-secret"].member == "serviceAccount:${google_service_account.runtime["web"].email}"
    error_message = "Only the worker and web runtimes may receive access to their respective Resend secrets."
  }
}

run "media_access_is_opt_in" {
  command = plan
  assert {
    condition     = length(google_service_account.upload_signer) == 0 && length(google_storage_bucket_iam_member.upload_creator) == 0 && length(google_storage_bucket_iam_member.preview_reader) == 0 && length(google_service_account_iam_member.web_signer) == 0
    error_message = "Media identities and grants require explicit opt-in."
  }
}

run "media_access_is_scoped" {
  command = plan
  variables { enable_media_access = true }
  override_resource {
    target          = google_service_account.runtime["web"]
    override_during = plan
    values          = { email = "web@synthetic.invalid" }
  }
  override_resource {
    target          = google_service_account.upload_signer[0]
    override_during = plan
    values          = { email = "signer@synthetic-project.iam.gserviceaccount.com", name = "projects/synthetic-project/serviceAccounts/signer@synthetic-project.iam.gserviceaccount.com" }
  }
  assert {
    condition     = google_storage_bucket_iam_member.upload_creator[0].role == "roles/storage.objectCreator" && google_storage_bucket_iam_member.upload_creator[0].bucket == var.bucket_names.uploads && google_storage_bucket_iam_member.upload_creator[0].member == "serviceAccount:signer@synthetic-project.iam.gserviceaccount.com" && google_storage_bucket_iam_member.preview_reader[0].role == "roles/storage.objectViewer" && google_storage_bucket_iam_member.preview_reader[0].bucket == var.bucket_names.public && google_storage_bucket_iam_member.preview_reader[0].member == "serviceAccount:web@synthetic.invalid" && google_service_account_iam_member.web_signer[0].role == "roles/iam.serviceAccountTokenCreator" && google_service_account_iam_member.web_signer[0].member == "serviceAccount:web@synthetic.invalid" && google_service_account_iam_member.web_signer[0].service_account_id == "projects/synthetic-project/serviceAccounts/signer@synthetic-project.iam.gserviceaccount.com"
    error_message = "Media grants must use the create-only, preview-read, and signer roles."
  }
}

run "upload_cors_is_limited" {
  command = plan
  variables { upload_allowed_origins = ["https://staging.ideam.app"] }
  assert {
    condition     = toset(google_storage_bucket.media["uploads"].cors[0].origin) == toset(["https://staging.ideam.app"]) && toset(google_storage_bucket.media["uploads"].cors[0].method) == toset(["POST", "PUT"]) && toset(google_storage_bucket.media["uploads"].cors[0].response_header) == toset(["Content-Type", "x-goog-content-length-range", "x-goog-if-generation-match"]) && length(google_storage_bucket.media["public"].cors) == 0 && length(google_storage_bucket.media["backups"].cors) == 0
    error_message = "Upload CORS must allow only configured origins, methods, and headers on the pending bucket."
  }
}

run "reject_wildcard_upload_origin" {
  command = plan
  variables { upload_allowed_origins = ["*"] }
  expect_failures = [var.upload_allowed_origins]
}

run "webhook_secret_is_pinned" {
  command = plan
  variables {
    enable_resend_secrets         = true
    resend_webhook_secret_version = "1"
  }
  assert {
    condition     = one(google_cloud_run_v2_service.runtime["web"].template[0].containers[0].env).name == "NUXT_RESEND_WEBHOOK_SECRET" && one(google_cloud_run_v2_service.runtime["web"].template[0].containers[0].env).value_source[0].secret_key_ref[0].version == "1" && length(google_cloud_run_v2_service.runtime["worker"].template[0].containers[0].env) == 0
    error_message = "Only the web service must receive the pinned webhook secret reference."
  }
}

run "reject_latest_webhook_secret" {
  command = plan
  variables {
    enable_resend_secrets         = true
    resend_webhook_secret_version = "latest"
  }
  expect_failures = [var.resend_webhook_secret_version]
}

run "worker_runtime_is_opt_in" {
  command = plan
  assert {
    condition     = length(google_secret_manager_secret_iam_member.worker_database) == 0 && length(google_cloud_run_v2_service.runtime["worker"].template[0].containers[0].env) == 0
    error_message = "Worker runtime settings and database access must be opt-in."
  }
}

run "worker_runtime_is_scoped_and_pinned" {
  command = plan
  variables {
    enable_task_delivery           = true
    enable_worker_runtime          = true
    worker_origin                  = "https://worker.synthetic.invalid"
    worker_database_secret_id      = "synthetic-worker-db"
    worker_database_secret_version = "3"
  }
  override_resource {
    target          = google_cloud_run_v2_service.runtime["worker"]
    override_during = plan
    values          = { uri = "https://worker.synthetic.invalid" }
  }
  override_resource {
    target          = google_service_account.runtime["worker"]
    override_during = plan
    values          = { email = "worker@synthetic.invalid" }
  }
  override_resource {
    target          = google_service_account.task_invoker[0]
    override_during = plan
    values          = { email = "task@synthetic.invalid", name = "projects/synthetic-idea-map-dev/serviceAccounts/task-sa@synthetic-idea-map-dev.iam.gserviceaccount.com" }
  }
  override_resource {
    target          = google_service_account.repair_invoker[0]
    override_during = plan
    values          = { email = "repair@synthetic.invalid" }
  }
  assert {
    condition     = length(google_cloud_run_v2_service.runtime["worker"].template[0].containers[0].env) == 6 && one([for e in google_cloud_run_v2_service.runtime["worker"].template[0].containers[0].env : e if e.name == "WORKER_PROVIDER_MODE"]).value == "provider" && one([for e in google_cloud_run_v2_service.runtime["worker"].template[0].containers[0].env : e if e.name == "WORKER_ORIGIN"]).value == "https://worker.synthetic.invalid" && one([for e in google_cloud_run_v2_service.runtime["worker"].template[0].containers[0].env : e if e.name == "TASK_INVOKER_EMAIL"]).value == "task@synthetic.invalid" && one([for e in google_cloud_run_v2_service.runtime["worker"].template[0].containers[0].env : e if e.name == "REPAIR_INVOKER_EMAIL"]).value == "repair@synthetic.invalid" && one([for e in google_cloud_run_v2_service.runtime["worker"].template[0].containers[0].env : e if e.name == "CLOUD_TASKS_QUEUE"]).value == "projects/synthetic-idea-map-dev/locations/us-central1/queues/idea-map-dev-queue"
    error_message = "The worker must receive only its intended task and identity settings."
  }
  assert {
    condition     = one([for e in google_cloud_run_v2_service.runtime["worker"].template[0].containers[0].env : e if e.name == "WORKER_DATABASE_URL"]).value_source[0].secret_key_ref[0].secret == "synthetic-worker-db" && one([for e in google_cloud_run_v2_service.runtime["worker"].template[0].containers[0].env : e if e.name == "WORKER_DATABASE_URL"]).value_source[0].secret_key_ref[0].version == "3" && google_secret_manager_secret_iam_member.worker_database[0].role == "roles/secretmanager.secretAccessor" && google_secret_manager_secret_iam_member.worker_database[0].secret_id == "synthetic-worker-db" && google_secret_manager_secret_iam_member.worker_database[0].member == "serviceAccount:worker@synthetic.invalid"
    error_message = "Only the worker must receive the pinned database secret and scoped access."
  }
  assert {
    condition     = length(google_cloud_run_v2_service.runtime["web"].template[0].containers[0].env) == 0 && google_cloud_scheduler_job.repair[0].paused
    error_message = "Worker credentials must not reach the web service and repair must remain paused."
  }
}

run "worker_runtime_requires_task_delivery" {
  command = plan
  variables {
    enable_worker_runtime          = true
    worker_origin                  = "https://worker.synthetic.invalid"
    worker_database_secret_id      = "synthetic-worker-db"
    worker_database_secret_version = "3"
  }
  expect_failures = [google_cloud_run_v2_service.runtime["worker"], google_cloud_run_v2_service.runtime["web"]]
}

run "reject_unpinned_worker_database" {
  command = plan
  variables { worker_database_secret_version = "latest" }
  expect_failures = [var.worker_database_secret_version]
}

run "reject_worker_origin_path" {
  command = plan
  variables { worker_origin = "https://worker.synthetic.invalid/tasks" }
  expect_failures = [var.worker_origin]
}

run "reject_worker_origin_mismatch" {
  command = plan
  variables {
    enable_task_delivery           = true
    enable_worker_runtime          = true
    worker_origin                  = "https://wrong.synthetic.invalid"
    worker_database_secret_id      = "synthetic-worker-db"
    worker_database_secret_version = "3"
  }
  override_resource {
    target          = google_cloud_run_v2_service.runtime["worker"]
    override_during = plan
    values          = { uri = "https://worker.synthetic.invalid" }
  }
  override_resource {
    target          = google_service_account.task_invoker[0]
    override_during = plan
    values          = { name = "projects/synthetic-idea-map-dev/serviceAccounts/task-sa@synthetic-idea-map-dev.iam.gserviceaccount.com" }
  }
  expect_failures = [google_cloud_run_v2_service.runtime["worker"]]
}

run "worker_runtime_requires_database_secret" {
  command = plan
  variables {
    enable_task_delivery  = true
    enable_worker_runtime = true
    worker_origin         = "https://worker.synthetic.invalid"
  }
  override_resource {
    target          = google_service_account.task_invoker[0]
    override_during = plan
    values          = { name = "projects/synthetic-idea-map-dev/serviceAccounts/task-sa@synthetic-idea-map-dev.iam.gserviceaccount.com" }
  }
  expect_failures = [google_cloud_run_v2_service.runtime["worker"], google_cloud_run_v2_service.runtime["web"]]
}
