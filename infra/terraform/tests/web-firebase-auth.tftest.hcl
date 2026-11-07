mock_provider "google" {
  override_during = plan
}

variables {
  project_id  = "synthetic-idea-map-prod"
  environment = "prod"
  bucket_names = {
    uploads = "synthetic-idea-map-prod-uploads"
    public  = "synthetic-idea-map-prod-public"
    backups = "synthetic-idea-map-prod-backups"
  }
  web_image    = "example.invalid/web@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  worker_image = "example.invalid/worker@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
}

run "web_auth_is_opt_in" {
  command = plan

  assert {
    condition     = length(google_project_iam_custom_role.web_firebase_session) == 0 && length(google_project_iam_member.web_firebase_session) == 0 && length(google_cloud_run_v2_service.runtime["web"].template[0].containers[0].env) == 0
    error_message = "Hosted Auth must not change an existing configuration by default."
  }
}

run "web_auth_uses_target_project_and_web_only_role" {
  command = plan

  variables {
    web_firebase_auth = {
      api_key        = "synthetic-browser-key"
      auth_domain    = "synthetic-idea-map-prod.firebaseapp.com"
      session_origin = "https://prod.example.invalid"
    }
  }

  override_resource {
    target          = google_service_account.runtime["web"]
    override_during = plan
    values          = { email = "web@synthetic.invalid" }
  }

  assert {
    condition = {
      for env in google_cloud_run_v2_service.runtime["web"].template[0].containers[0].env : env.name => env.value
      } == {
      NUXT_AUTH_PROVIDER_MODE          = "provider"
      NUXT_PUBLIC_AUTH_PROVIDER_MODE   = "provider"
      NUXT_FIREBASE_PROJECT_ID         = "synthetic-idea-map-prod"
      NUXT_PUBLIC_FIREBASE_PROJECT_ID  = "synthetic-idea-map-prod"
      NUXT_PUBLIC_FIREBASE_API_KEY     = "synthetic-browser-key"
      NUXT_PUBLIC_FIREBASE_AUTH_DOMAIN = "synthetic-idea-map-prod.firebaseapp.com"
      NUXT_SESSION_ORIGIN              = "https://prod.example.invalid"
    }
    error_message = "The web container must use hosted Auth and the same project on the browser and server."
  }

  assert {
    condition     = toset(google_project_iam_custom_role.web_firebase_session[0].permissions) == toset(["firebaseauth.users.createSession", "firebaseauth.users.get"]) && google_project_iam_member.web_firebase_session[0].member == "serviceAccount:web@synthetic.invalid" && length(google_cloud_run_v2_service.runtime["worker"].template[0].containers[0].env) == 0
    error_message = "Only the web service identity may receive the scoped session role and Firebase configuration."
  }
}

run "reject_auth_domain_from_another_project" {
  command = plan

  variables {
    web_firebase_auth = {
      api_key        = "synthetic-browser-key"
      auth_domain    = "synthetic-idea-map-dev.firebaseapp.com"
      session_origin = "https://prod.example.invalid"
    }
  }

  expect_failures = [var.web_firebase_auth]
}
