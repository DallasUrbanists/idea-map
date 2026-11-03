mock_provider "google" {
  override_during = plan
}

variables {
  project_id           = "synthetic-idea-map"
  region               = "us-central1"
  name_prefix          = "ideamap-synthetic"
  worker_service_name  = "synthetic-worker"
  worker_origin        = "https://worker.synthetic.invalid"
  worker_runtime_email = "worker@synthetic-idea-map.iam.gserviceaccount.com"
  worker_image         = "example.invalid/worker@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
}

run "disabled_by_default" {
  command = plan
  assert {
    condition     = length(data.google_cloud_run_v2_service.worker) == 0 && length(google_cloud_tasks_queue.jobs) == 0 && length(google_cloud_scheduler_job.repair) == 0 && length(google_service_account.task_invoker) == 0 && length(google_service_account.repair_invoker) == 0
    error_message = "Disabled configuration must create no task delivery resources."
  }
  assert {
    condition     = length(terraform_data.reviewed_worker) == 0 && length(google_cloud_run_v2_service_iam_member.task_invoker) == 0 && length(google_cloud_run_v2_service_iam_member.repair_invoker) == 0 && length(google_cloud_tasks_queue_iam_member.worker_enqueue) == 0 && length(google_cloud_tasks_queue_iam_member.worker_inspect) == 0 && length(google_service_account_iam_member.worker_task_identity) == 0
    error_message = "Disabled configuration must create no IAM members or worker lookup."
  }
}

run "scoped_paused_delivery" {
  command = plan
  variables { enable_isolated_staging = true }
  override_data {
    target          = data.google_cloud_run_v2_service.worker[0]
    override_during = plan
    values = {
      uri                  = "https://worker.synthetic.invalid"
      ingress              = "INGRESS_TRAFFIC_INTERNAL_ONLY"
      invoker_iam_disabled = false
      template             = [{ service_account = "worker@synthetic-idea-map.iam.gserviceaccount.com", containers = [{ image = "example.invalid/worker@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }] }]
    }
  }
  override_resource {
    target          = google_service_account.task_invoker[0]
    override_during = plan
    values          = { email = "task-sa@synthetic-idea-map.iam.gserviceaccount.com", name = "projects/synthetic-idea-map/serviceAccounts/task-sa@synthetic-idea-map.iam.gserviceaccount.com" }
  }
  override_resource {
    target          = google_service_account.repair_invoker[0]
    override_during = plan
    values          = { email = "repair-sa@synthetic-idea-map.iam.gserviceaccount.com" }
  }
  assert {
    condition     = google_cloud_tasks_queue.jobs[0].retry_config[0].max_attempts == 5 && google_cloud_tasks_queue.jobs[0].rate_limits[0].max_concurrent_dispatches == 1
    error_message = "The queue must use bounded retries and concurrency."
  }
  assert {
    condition     = google_cloud_scheduler_job.repair[0].paused && google_cloud_scheduler_job.repair[0].schedule == "0 * * * *" && google_cloud_scheduler_job.repair[0].http_target[0].oidc_token[0].audience == var.worker_origin
    error_message = "Hourly repair must start paused with the exact worker audience."
  }
  assert {
    condition     = google_cloud_run_v2_service_iam_member.task_invoker[0].member != google_cloud_run_v2_service_iam_member.repair_invoker[0].member && google_cloud_tasks_queue_iam_member.worker_enqueue[0].role == "roles/cloudtasks.enqueuer" && google_cloud_tasks_queue_iam_member.worker_inspect[0].role == "roles/cloudtasks.viewer"
    error_message = "Task and repair identities must be distinct and queue access scoped."
  }
  assert {
    condition     = google_cloud_run_v2_service_iam_member.task_invoker[0].name == var.worker_service_name && google_cloud_run_v2_service_iam_member.repair_invoker[0].name == var.worker_service_name && google_service_account_iam_member.worker_task_identity[0].service_account_id == google_service_account.task_invoker[0].name && google_cloud_tasks_queue_iam_member.worker_enqueue[0].name == google_cloud_tasks_queue.jobs[0].name && google_cloud_tasks_queue_iam_member.worker_inspect[0].name == google_cloud_tasks_queue.jobs[0].name
    error_message = "Invocation, task identity, and queue grants must target only the reviewed resources."
  }
}

run "reject_wrong_worker_origin" {
  command = plan
  variables { enable_isolated_staging = true }
  override_data {
    target          = data.google_cloud_run_v2_service.worker[0]
    override_during = plan
    values = {
      uri                  = "https://different.synthetic.invalid"
      ingress              = "INGRESS_TRAFFIC_INTERNAL_ONLY"
      invoker_iam_disabled = false
      template             = [{ service_account = "worker@synthetic-idea-map.iam.gserviceaccount.com", containers = [{ image = "example.invalid/worker@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }] }]
    }
  }
  expect_failures = [terraform_data.reviewed_worker]
}

run "reject_public_worker" {
  command = plan
  variables { enable_isolated_staging = true }
  override_data {
    target          = data.google_cloud_run_v2_service.worker[0]
    override_during = plan
    values = {
      uri                  = "https://worker.synthetic.invalid"
      ingress              = "INGRESS_TRAFFIC_ALL"
      invoker_iam_disabled = true
      template             = [{ service_account = "worker@synthetic-idea-map.iam.gserviceaccount.com", containers = [{ image = "example.invalid/worker@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }] }]
    }
  }
  expect_failures = [terraform_data.reviewed_worker]
}

run "reject_wrong_worker_identity" {
  command = plan
  variables { enable_isolated_staging = true }
  override_data {
    target          = data.google_cloud_run_v2_service.worker[0]
    override_during = plan
    values = {
      uri                  = "https://worker.synthetic.invalid"
      ingress              = "INGRESS_TRAFFIC_INTERNAL_ONLY"
      invoker_iam_disabled = false
      template             = [{ service_account = "different@synthetic-idea-map.iam.gserviceaccount.com", containers = [{ image = "example.invalid/worker@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }] }]
    }
  }
  expect_failures = [terraform_data.reviewed_worker]
}

run "reject_shared_runtime_and_invoker" {
  command = plan
  variables {
    enable_isolated_staging = true
    worker_runtime_email    = "ideamap-synthetic-task@synthetic-idea-map.iam.gserviceaccount.com"
  }
  override_data {
    target          = data.google_cloud_run_v2_service.worker[0]
    override_during = plan
    values = {
      uri                  = "https://worker.synthetic.invalid"
      ingress              = "INGRESS_TRAFFIC_INTERNAL_ONLY"
      invoker_iam_disabled = false
      template             = [{ service_account = "ideamap-synthetic-task@synthetic-idea-map.iam.gserviceaccount.com", containers = [{ image = "example.invalid/worker@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }] }]
    }
  }
  expect_failures = [terraform_data.reviewed_worker]
}

run "reject_non_synthetic_prefix" {
  command = plan
  variables { name_prefix = "production" }
  expect_failures = [var.name_prefix]
}

run "reject_wrong_worker_image" {
  command = plan
  variables { enable_isolated_staging = true }
  override_data {
    target          = data.google_cloud_run_v2_service.worker[0]
    override_during = plan
    values = {
      uri                  = "https://worker.synthetic.invalid"
      ingress              = "INGRESS_TRAFFIC_INTERNAL_ONLY"
      invoker_iam_disabled = false
      template             = [{ service_account = "worker@synthetic-idea-map.iam.gserviceaccount.com", containers = [{ image = "example.invalid/worker@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }] }]
    }
  }
  expect_failures = [terraform_data.reviewed_worker]
}

run "reject_unpinned_worker_image" {
  command = plan
  variables { worker_image = "example.invalid/worker:latest" }
  expect_failures = [var.worker_image]
}
