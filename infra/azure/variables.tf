variable "subscription_id" {
  type    = string
  default = "e7b998b6-a628-4548-a9d6-f54cf98a0464"
}

variable "kubeconfig" {
  type        = string
  description = "Local AKS kubeconfig using kubelogin's existing Azure CLI session."
  default     = "../../artifacts/deploy/kubeconfig"
}

variable "image" {
  type        = string
  description = "Immutable Linux image built in the existing Central US registry."
  validation {
    condition     = can(regex("^decionisacr\\.azurecr\\.io/raidrumble@sha256:[a-f0-9]{64}$", var.image))
    error_message = "Use the verified RaidRumble ACR image digest."
  }
}

variable "ingress_ipv4" {
  type        = string
  description = "Existing decionis-nginx load balancer, verified from the SwarmPay ingress."
  default     = "52.143.254.111"
  validation {
    condition     = can(cidrnetmask("${var.ingress_ipv4}/32"))
    error_message = "Provide the existing ingress IPv4 address."
  }
}

locals {
  name      = "raidrumble"
  namespace = "decionis"
  hostname  = "raids.decionis.com"
  labels = {
    "app.kubernetes.io/name"    = local.name
    "app.kubernetes.io/part-of" = local.name
  }
}
