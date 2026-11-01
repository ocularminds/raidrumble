resource "kubernetes_config_map_v1" "runtime" {
  metadata {
    name      = "${local.name}-config"
    namespace = local.namespace
    labels    = local.labels
  }
  data = {
    NODE_ENV                = "production"
    HOST                    = "0.0.0.0"
    PORT                    = "3000"
    DATA_DIR                = "/app/data"
    PUBLIC_BASE_URL         = "https://${local.hostname}"
    DASHBOARD_URL           = "https://${local.hostname}"
    OVERLAY_URL             = "https://${local.hostname}"
    TWITCH_AUTH_URL         = "https://${local.hostname}/auth/twitch/callback"
    POLICY_GATE             = "decionis"
    DECIONIS_MODE           = "ENFORCEMENT"
    DECIONIS_API_BASE       = "https://api.decionis.com"
    DECIONIS_POLICY_ID      = var.policy_id
    DECIONIS_POLICY_VERSION = var.policy_version
  }
}

resource "kubernetes_persistent_volume_claim_v1" "data" {
  metadata {
    name      = "${local.name}-data"
    namespace = local.namespace
    labels    = local.labels
  }
  spec {
    access_modes       = ["ReadWriteOnce"]
    storage_class_name = "decionis-zrs"
    resources {
      requests = { storage = "8Gi" }
    }
  }
  wait_until_bound = false
  lifecycle {
    prevent_destroy = true
  }
}

resource "kubernetes_deployment_v1" "app" {
  metadata {
    name      = local.name
    namespace = local.namespace
    labels    = local.labels
  }
  spec {
    replicas                  = 1
    revision_history_limit    = 3
    progress_deadline_seconds = 600
    strategy {
      type = "Recreate"
    }
    selector {
      match_labels = local.labels
    }
    template {
      metadata {
        labels = local.labels
        annotations = {
          "raidrumble/config" = sha256(jsonencode(kubernetes_config_map_v1.runtime.data))
        }
      }
      spec {
        automount_service_account_token  = false
        termination_grace_period_seconds = 45
        node_selector                    = { "kubernetes.io/os" = "linux" }
        security_context {
          run_as_non_root        = true
          run_as_user            = 1000
          run_as_group           = 1000
          fs_group               = 1000
          fs_group_change_policy = "OnRootMismatch"
          seccomp_profile {
            type = "RuntimeDefault"
          }
        }
        container {
          name              = local.name
          image             = var.image
          image_pull_policy = "IfNotPresent"
          port {
            name           = "http"
            container_port = 3000
          }
          env_from {
            config_map_ref {
              name = kubernetes_config_map_v1.runtime.metadata[0].name
            }
          }
          env_from {
            secret_ref {
              name = "${local.name}-runtime"
            }
          }
          security_context {
            allow_privilege_escalation = false
            read_only_root_filesystem  = true
            capabilities {
              drop = ["ALL"]
            }
          }
          resources {
            requests = { cpu = "100m", memory = "256Mi" }
            limits   = { cpu = "1", memory = "768Mi" }
          }
          volume_mount {
            name       = "data"
            mount_path = "/app/data"
          }
          volume_mount {
            name       = "tmp"
            mount_path = "/tmp"
          }
          startup_probe {
            http_get {
              path = "/health"
              port = "http"
            }
            period_seconds    = 5
            timeout_seconds   = 3
            failure_threshold = 30
          }
          readiness_probe {
            http_get {
              path = "/health"
              port = "http"
            }
            period_seconds  = 5
            timeout_seconds = 3
          }
          liveness_probe {
            http_get {
              path = "/health"
              port = "http"
            }
            period_seconds    = 15
            timeout_seconds   = 3
            failure_threshold = 4
          }
        }
        volume {
          name = "data"
          persistent_volume_claim {
            claim_name = kubernetes_persistent_volume_claim_v1.data.metadata[0].name
          }
        }
        volume {
          name = "tmp"
          empty_dir {
            size_limit = "64Mi"
          }
        }
      }
    }
  }
  depends_on = [kubernetes_network_policy_v1.app]
  timeouts {
    create = "15m"
    update = "15m"
  }
}

resource "kubernetes_service_v1" "app" {
  metadata {
    name      = local.name
    namespace = local.namespace
    labels    = local.labels
  }
  spec {
    type     = "ClusterIP"
    selector = local.labels
    port {
      name        = "http"
      port        = 3000
      target_port = "http"
    }
  }
}
