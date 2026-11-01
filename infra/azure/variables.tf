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

variable "policy_id" {
  type        = string
  description = "Immutable RaidRumble policy bundle UUID returned by the Decionis publication API."
  validation {
    condition     = can(regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$", var.policy_id))
    error_message = "Pin the published RaidRumble bundle UUID for this Azure release."
  }
}

variable "policy_version" {
  type        = string
  description = "Version returned with the published RaidRumble policy bundle."
  validation {
    condition     = length(trimspace(var.policy_version)) > 0 && length(var.policy_version) <= 100
    error_message = "Provide the published policy version."
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
