output "argocd_helm_status" {
  value       = helm_release.argocd.status
  description = "The status of the ArgoCD Helm deployment"
}

output "namespaces" {
  value = [
    kubernetes_namespace.argocd.metadata[0].name,
    kubernetes_namespace.idp_system.metadata[0].name
  ]
  description = "List of created namespaces"
}
