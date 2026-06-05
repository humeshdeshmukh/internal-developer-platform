import os
import shutil
import subprocess
import logging

logger = logging.getLogger("git-utils")

def run_git_cmd(repo_path, args):
    try:
        res = subprocess.run(
            ["git"] + args,
            cwd=repo_path,
            capture_output=True,
            text=True,
            check=True
        )
        return res.stdout
    except subprocess.CalledProcessError as e:
        logger.error(f"Git command failed: git {' '.join(args)}: {e.stderr}")
        raise RuntimeError(e.stderr)

def init_git_repo(repo_path, templates_path):
    if os.path.exists(os.path.join(repo_path, ".git")):
        logger.info(f"Git repository already exists at {repo_path}")
        return False
        
    os.makedirs(repo_path, exist_ok=True)
    
    # Initialize repository
    run_git_cmd(repo_path, ["init"])
    run_git_cmd(repo_path, ["config", "http.receivepack", "true"])
    run_git_cmd(repo_path, ["config", "user.name", "Aegis IDP Portal"])
    run_git_cmd(repo_path, ["config", "user.email", "portal@aegis.local"])
    
    # Create directory structures
    os.makedirs(os.path.join(repo_path, "charts"), exist_ok=True)
    os.makedirs(os.path.join(repo_path, "pipelines"), exist_ok=True)
    os.makedirs(os.path.join(repo_path, "kubernetes"), exist_ok=True)
    
    # Write initial README
    readme_content = """# Aegis IDP GitOps Repository
This repository contains the infrastructure configurations, helm charts, and pipeline manifests managed automatically by the Aegis Internal Developer Platform.

Do not edit files manually unless you are familiar with the GitOps flow.
"""
    with open(os.path.join(repo_path, "README.md"), "w") as f:
        f.write(readme_content)
        
    run_git_cmd(repo_path, ["add", "."])
    run_git_cmd(repo_path, ["commit", "-m", "Initial commit: Set up Aegis IDP directory structure"])
    logger.info("Initialized GitOps repository successfully")
    return True

def get_git_log(repo_path):
    try:
        output = run_git_cmd(repo_path, ["log", "--pretty=format:%h|%an|%ar|%s", "-n", "15"])
        commits = []
        if not output.strip():
            return commits
        for line in output.strip().split("\n"):
            if not line:
                continue
            parts = line.split("|", 3)
            if len(parts) == 4:
                commits.append({
                    "hash": parts[0],
                    "author": parts[1],
                    "age": parts[2],
                    "message": parts[3]
                })
        return commits
    except Exception as e:
        logger.error(f"Failed to get git log: {e}")
        return []

def scaffold_service(repo_path, templates_path, name, namespace, image_repo, image_tag, port, replicas, cpu, memory):
    # Copy boilerplate chart
    src_chart = os.path.join(templates_path, "charts", "dev-service")
    dest_chart = os.path.join(repo_path, "charts", name)
    
    if os.path.exists(dest_chart):
        raise RuntimeError(f"Service '{name}' already exists in GitOps repository.")
        
    shutil.copytree(src_chart, dest_chart)
    
    # Update Chart.yaml
    chart_file = os.path.join(dest_chart, "Chart.yaml")
    chart_content = f"""apiVersion: v2
name: {name}
description: Scaffolder-generated Helm chart for service {name}
type: application
version: 0.1.0
appVersion: "{image_tag}"
"""
    with open(chart_file, "w") as f:
        f.write(chart_content)
        
    # Update values.yaml
    values_file = os.path.join(dest_chart, "values.yaml")
    values_content = f"""replicaCount: {replicas}

image:
  repository: {image_repo}
  tag: "{image_tag}"
  pullPolicy: IfNotPresent

service:
  type: ClusterIP
  port: {port}

resources:
  requests:
    cpu: "{cpu}"
    memory: "{memory}"
  limits:
    cpu: "{cpu}"
    memory: "{memory}"
"""
    with open(values_file, "w") as f:
        f.write(values_content)
        
    # Generate standalone ArgoCD Application manifest
    app_manifest = f"""apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: {name}
  namespace: argocd
spec:
  project: default
  source:
    repoURL: http://idp-portal.idp-system.svc.cluster.local:5007/git/idp-repo.git
    targetRevision: HEAD
    path: charts/{name}
  destination:
    server: https://kubernetes.default.svc
    namespace: {namespace}
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
"""
    manifest_file = os.path.join(repo_path, "kubernetes", f"{name}-application.yaml")
    with open(manifest_file, "w") as f:
        f.write(app_manifest)
        
    # Add and commit
    run_git_cmd(repo_path, ["add", "."])
    msg = f"scaffold(service): Add Helm chart and ArgoCD Application for {name}"
    run_git_cmd(repo_path, ["commit", "-m", msg])
    return msg

def scaffold_pipeline(repo_path, name, repository, branch, steps):
    pipeline_file = os.path.join(repo_path, "pipelines", f"{name}-pipeline.yaml")
    
    steps_yaml = ""
    for step in steps:
        steps_yaml += f"  - name: {step}\n    run: echo 'Executing step: {step}'\n"
        
    pipeline_content = f"""name: {name}-pipeline
on:
  push:
    branches:
      - {branch}
repository: {repository}
jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
{steps_yaml}"""

    with open(pipeline_file, "w") as f:
        f.write(pipeline_content)
        
    run_git_cmd(repo_path, ["add", "."])
    msg = f"scaffold(pipeline): Create CI/CD pipeline definition for {name}"
    run_git_cmd(repo_path, ["commit", "-m", msg])
    return msg
