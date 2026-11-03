terraform {
  required_version = ">= 1.13.0, < 2.0.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "6.50.0"
    }
  }
  # Supply an authorized, isolated state bucket and prefix at initialization.
  backend "gcs" {}
}

provider "google" {
  project = var.project_id
  region  = var.region
}
