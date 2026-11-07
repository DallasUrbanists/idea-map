resource "google_project_iam_custom_role" "web_firebase_session" {
  count       = var.web_firebase_auth == null ? 0 : 1
  project     = var.project_id
  role_id     = "ideaMapWebFirebaseSession${title(var.environment)}"
  title       = "Idea Map ${var.environment} web Firebase sessions"
  description = "Issue Firebase session cookies and read users for revocation checks."
  permissions = ["firebaseauth.users.createSession", "firebaseauth.users.get"]
}

resource "google_project_iam_member" "web_firebase_session" {
  count   = var.web_firebase_auth == null ? 0 : 1
  project = var.project_id
  role    = google_project_iam_custom_role.web_firebase_session[0].name
  member  = "serviceAccount:${google_service_account.runtime["web"].email}"
}
