#!/usr/bin/env bash

# ==============================================================================
# Aegis Internal Developer Platform (IDP) - Bootstrapping Script
# ==============================================================================

set -e

# Terminal Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}======================================================================${NC}"
echo -e "${CYAN}       BOOTSTRAPPING AEGIS INTERNAL DEVELOPER PLATFORM (IDP)          ${NC}"
echo -e "${CYAN}======================================================================${NC}"

# Define script and project directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

# Helper function to print step headers
print_step() {
    echo -e "\n${BLUE}>>> [STEP] $1...${NC}"
}

# ------------------------------------------------------------------------------
# STEP 1: Provision Infrastructure with Terraform
# ------------------------------------------------------------------------------
print_step "1/5: Running Terraform Provisioning"
echo -e "${YELLOW}Initializing and applying Terraform bootstrap configuration...${NC}"
cd terraform
terraform init
terraform apply -auto-approve
cd ..
echo -e "${GREEN}[OK] Core namespaces and ArgoCD Helm release provisioned.${NC}"

# ------------------------------------------------------------------------------
# STEP 2: Build Developer Portal Image
# ------------------------------------------------------------------------------
print_step "2/5: Building Developer Portal Docker Image"
echo -e "${YELLOW}Building Docker Image 'idp-portal:latest'...${NC}"
docker build -t idp-portal:latest .

echo -e "${YELLOW}Loading 'idp-portal:latest' into Minikube image cache...${NC}"
minikube image load idp-portal:latest
echo -e "${GREEN}[OK] Docker image loaded into Minikube successfully.${NC}"

# ------------------------------------------------------------------------------
# STEP 3: Deploy Developer Portal
# ------------------------------------------------------------------------------
print_step "3/5: Deploying Developer Portal Pods"
echo -e "${YELLOW}Applying Kubernetes manifests for idp-portal...${NC}"
kubectl apply -f kubernetes/idp-portal.yaml
echo -e "${GREEN}[OK] Service account, RBAC rules, service, and portal applied.${NC}"

# ------------------------------------------------------------------------------
# STEP 4: Verify Deployment Rollout Statuses
# ------------------------------------------------------------------------------
print_step "4/5: Verifying Portal and ArgoCD Rollouts"
echo -e "${YELLOW}Waiting for idp-portal deployment to become ready...${NC}"
kubectl rollout status deployment/idp-portal -n idp-system --timeout=120s

echo -e "${YELLOW}Waiting for ArgoCD server deployment to become ready...${NC}"
kubectl rollout status deployment/argocd-server -n argocd --timeout=150s
echo -e "${GREEN}[OK] Platform services are active.${NC}"

# ------------------------------------------------------------------------------
# STEP 5: Service Summary & Access Points
# ------------------------------------------------------------------------------
print_step "5/5: Bootstrapping Complete - Exposing Endpoints"

# Fetch Minikube IP
MINIKUBE_IP=$(minikube ip)

# Fetch NodePorts
PORTAL_PORT=$(kubectl get svc idp-portal -n idp-system -o jsonpath='{.spec.ports[0].nodePort}')
ARGOCD_PORT=$(kubectl get svc argocd-server -n argocd -o jsonpath='{.spec.ports[?(@.port==80)].nodePort}')

PORTAL_URL="http://${MINIKUBE_IP}:${PORTAL_PORT}"
ARGOCD_URL="http://${MINIKUBE_IP}:${ARGOCD_PORT}"

# Retrieve ArgoCD initial admin password
ARGOCD_PASSWORD=$(kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}" | base64 -d)

echo -e "\n${GREEN}======================================================================${NC}"
echo -e "${GREEN}      AEGIS INTERNAL DEVELOPER PLATFORM (IDP) BOOTSTRAP COMPLETE      ${NC}"
echo -e "${GREEN}======================================================================${NC}"

echo -e "\n${YELLOW}Service Endpoints:${NC}"
echo -e "----------------------------------------------------------------------"
echo -e "${CYAN}1. Aegis Developer Portal (Backstage IDP)${NC}"
echo -e "   - Access URL:  ${PORTAL_URL}"
echo -e "   - Login URL:   ${PORTAL_URL}/keycloak.html"
echo -e "   - SSO Account: User: admin / password: admin123"
echo -e "   - Port Forward alternative: kubectl port-forward svc/idp-portal 5007:5007 -n idp-system"

echo -e "\n${CYAN}2. ArgoCD Web Console${NC}"
echo -e "   - Access URL:  ${ARGOCD_URL}"
echo -e "   - Credentials: User: admin / Password: ${ARGOCD_PASSWORD}"
echo -e "   - Port Forward alternative: kubectl port-forward svc/argocd-server 8080:80 -n argocd"
echo -e "----------------------------------------------------------------------\n"
