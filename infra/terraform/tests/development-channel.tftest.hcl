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

run "channel_is_disabled_by_default" {
  command = plan
  assert {
    condition     = length(google_monitoring_notification_channel.development_email) == 0
    error_message = "A notification channel must not be created by default."
  }
}

run "development_channel_uses_reviewed_recipient" {
  command = plan
  variables {
    enable_development_email_channel = true
    development_notification_email   = "synthetic+alert@example.invalid"
  }
  assert {
    condition = google_monitoring_notification_channel.development_email[0].type == "email" && (
      nonsensitive(google_monitoring_notification_channel.development_email[0].labels.email_address == "synthetic+alert@example.invalid") &&
      issensitive(google_monitoring_notification_channel.development_email[0].labels.email_address) &&
      google_monitoring_notification_channel.development_email[0].force_delete == false
    )
    error_message = "The development channel must use the reviewed recipient and refuse forced deletion."
  }
}

run "production_channel_is_rejected" {
  command = plan
  variables {
    environment                      = "prod"
    enable_development_email_channel = true
    development_notification_email   = "synthetic@example.invalid"
  }
  expect_failures = [var.enable_development_email_channel]
}

run "missing_recipient_is_rejected" {
  command = plan
  variables {
    enable_development_email_channel = true
  }
  expect_failures = [var.development_notification_email]
}

run "multiple_recipients_are_rejected" {
  command = plan
  variables {
    enable_development_email_channel = true
    development_notification_email   = "first@example.invalid,second@example.invalid"
  }
  expect_failures = [var.development_notification_email]
}
