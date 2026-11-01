output "url" {
  value = "https://${local.hostname}"
}

output "image" {
  value = var.image
}

output "namespace" {
  value = local.namespace
}

output "data_claim" {
  value = kubernetes_persistent_volume_claim_v1.data.metadata[0].name
}
