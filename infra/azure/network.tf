resource "kubernetes_network_policy_v1" "app" {
  metadata {
    name      = local.name
    namespace = local.namespace
    labels    = local.labels
  }
  spec {
    pod_selector {
      match_labels = local.labels
    }
    policy_types = ["Ingress", "Egress"]
    ingress {
      from {
        namespace_selector {
          match_labels = { "kubernetes.io/metadata.name" = "app-routing-system" }
        }
        pod_selector {
          match_labels = { app = "nginx-decionis-0" }
        }
      }
      ports {
        protocol = "TCP"
        port     = "3000"
      }
    }
    egress {
      to {
        namespace_selector {
          match_labels = { "kubernetes.io/metadata.name" = "kube-system" }
        }
        pod_selector {
          match_labels = { "k8s-app" = "kube-dns" }
        }
      }
      ports {
        protocol = "UDP"
        port     = "53"
      }
      ports {
        protocol = "TCP"
        port     = "53"
      }
    }
    egress {
      # The authority shares this ingress. AKS may apply egress policy after
      # translating its public load-balancer address to a private ingress pod.
      to {
        namespace_selector {
          match_labels = { "kubernetes.io/metadata.name" = "app-routing-system" }
        }
        pod_selector {
          match_labels = { app = "nginx-decionis-0" }
        }
      }
      ports {
        protocol = "TCP"
        port     = "443"
      }
    }
    egress {
      to {
        ip_block {
          cidr = "0.0.0.0/0"
          except = [
            "0.0.0.0/8", "10.0.0.0/8", "127.0.0.0/8", "169.254.0.0/16",
            "172.16.0.0/12", "192.168.0.0/16", "168.63.129.16/32",
            "224.0.0.0/4", "240.0.0.0/4"
          ]
        }
      }
      ports {
        protocol = "TCP"
        port     = "443"
      }
    }
  }
}

resource "azurerm_dns_a_record" "app" {
  name                = "raids"
  zone_name           = "decionis.com"
  resource_group_name = "decionis-rg"
  ttl                 = 300
  records             = [var.ingress_ipv4]
  tags                = { application = "raidrumble" }
}

resource "kubernetes_ingress_v1" "app" {
  metadata {
    name      = local.name
    namespace = local.namespace
    labels    = local.labels
    annotations = {
      "cert-manager.io/cluster-issuer"                     = "letsencrypt-prod"
      "nginx.ingress.kubernetes.io/force-ssl-redirect"     = "true"
      "nginx.ingress.kubernetes.io/proxy-body-size"        = "16k"
      "nginx.ingress.kubernetes.io/proxy-buffering"        = "off"
      "nginx.ingress.kubernetes.io/proxy-read-timeout"     = "3600"
      "nginx.ingress.kubernetes.io/proxy-send-timeout"     = "3600"
      "nginx.ingress.kubernetes.io/enable-access-log"      = "false"
      "nginx.ingress.kubernetes.io/limit-connections"      = "24"
      "nginx.ingress.kubernetes.io/limit-rps"              = "20"
      "nginx.ingress.kubernetes.io/limit-burst-multiplier" = "3"
    }
  }
  spec {
    ingress_class_name = "decionis-nginx"
    tls {
      hosts       = [local.hostname]
      secret_name = "${local.name}-tls"
    }
    rule {
      host = local.hostname
      http {
        path {
          path      = "/"
          path_type = "Prefix"
          backend {
            service {
              name = kubernetes_service_v1.app.metadata[0].name
              port {
                name = "http"
              }
            }
          }
        }
      }
    }
  }
  depends_on = [azurerm_dns_a_record.app]
}
