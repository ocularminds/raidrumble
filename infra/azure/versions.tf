terraform {
  required_version = ">= 1.5.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.20"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.38"
    }
  }

  # Separate state from SwarmPay and the platform; no runtime credentials enter it.
  # The signed-in deployment operator can retrieve the account key through ARM.
  backend "azurerm" {
    resource_group_name  = "decionis-prod-platform-rg"
    storage_account_name = "decionisprode7b998b6"
    container_name       = "tfstate"
    key                  = "raidrumble.tfstate"
    use_azuread_auth     = false
    subscription_id      = "e7b998b6-a628-4548-a9d6-f54cf98a0464"
    tenant_id            = "b4ed9e39-5ea2-463b-8756-d31a4da2d7fa"
  }
}

provider "azurerm" {
  subscription_id                 = var.subscription_id
  resource_provider_registrations = "none"
  features {}
}

provider "kubernetes" {
  config_path    = var.kubeconfig
  config_context = "decionis-aks"
}
