#!/usr/bin/env bash

# ==============================================================================
# Aegis Internal Developer Platform (IDP) - Teardown Script
# ==============================================================================

# Terminal Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}======================================================================${NC}"
echo -e "${CYAN}       TEARING DOWN AEGIS INTERNAL DEVELOPER PLATFORM (IDP)           ${NC}"
echo -e "${CYAN}======================================================================${NC}"

# Define script and project directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

# Helper function to print step headers
print_step() {
    echo -e "\n${BLUE}>>> [STEP] $1...${NC}"
}

# ------------------------------------------------------------------------------
# STEP 1: Delete Platform Portal Kubernetes Manifests
# ------------------------------------------------------------------------------
print_step "1/4: Tearing down Platform Portal"
if kubectl get deployment idp-portal -n idp-system &>/dev/null; then
    echo -e "${YELLOW}Deleting portal Kubernetes manifests...${NC}"
    kubectl delete -f kubernetes/idp-portal.yaml --ignore-not-found
    echo -e "${GREEN}[OK] Platform portal manifests deleted.${NC}"
else
    echo -e "${YELLOW}Platform portal deployment not found, skipping...${NC}"
fi

# ------------------------------------------------------------------------------
# STEP 2: Delete dynamic namespaces created by developer self-service
# ------------------------------------------------------------------------------
print_step "2/4: Cleaning up Dynamic Developer Workloads"
echo -e "${YELLOW}Deleting Kubernetes namespaces managed by Aegis IDP...${NC}"
kubectl delete namespaces -l managed-by=aegis-idp --ignore-not-found
echo -e "${GREEN}[OK] Dynamic workloads cleaned up.${NC}"

# ------------------------------------------------------------------------------
# STEP 3: Destroy Core Platform Infrastructure via Terraform
# ------------------------------------------------------------------------------
print_step "3/4: Tearing down Core Infrastructure with Terraform"
if [ -d "terraform" ]; then
    echo -e "${YELLOW}Running Terraform destroy...${NC}"
    cd terraform
    terraform destroy -auto-approve
    cd ..
    echo -e "${GREEN}[OK] Core infrastructure destroyed.${NC}"
else
    echo -e "${RED}[WARNING] Terraform directory not found. Skipping.${NC}"
fi

# ------------------------------------------------------------------------------
# STEP 4: Double Check Clean up
# ------------------------------------------------------------------------------
print_step "4/4: Confirming Namespace Deletion"
echo -e "${YELLOW}Checking namespaces list...${NC}"
kubectl get namespaces
echo -e "${GREEN}[OK] Teardown finished.${NC}"

echo -e "\n${GREEN}======================================================================${NC}"
echo -e "${GREEN}      TEARDOWN COMPLETED SUCCESSFULLY - CLUSTER IS CLEAN              ${NC}"
echo -e "${GREEN}======================================================================${NC}"
