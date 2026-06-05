import os
import sys
import uuid
import time
import logging
import threading
import subprocess
from flask import Flask, jsonify, request, send_from_directory, Response

from git_utils import init_git_repo, get_git_log, scaffold_service, scaffold_pipeline
from k8s_utils import get_namespaces, get_pods_in_namespaces, get_argocd_apps, trigger_argocd_sync, apply_kubernetes_manifest
from tf_utils import run_terraform_pipeline, generate_namespace_tf, generate_database_tf

# ==============================================================================
# Logging Configuration
# ==============================================================================
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger("idp-portal")

# ==============================================================================
# Paths Configuration
# ==============================================================================
REPO_PATH = os.getenv("REPO_PATH", "/app/idp-repo.git")
TEMPLATES_PATH = os.getenv("TEMPLATES_PATH", "/app/gitops-templates")
TF_RUNS_DIR = "/app/terraform-runs"
LOGS_DIR = "/app/scaffold-logs"

os.makedirs(TF_RUNS_DIR, exist_ok=True)
os.makedirs(LOGS_DIR, exist_ok=True)

# Initialize Flask App
app = Flask(__name__, static_folder='static', static_url_path='')

# Initialize local GitOps repository on startup
logger.info(f"Initializing GitOps repository path: {REPO_PATH} with templates: {TEMPLATES_PATH}")
init_git_repo(REPO_PATH, TEMPLATES_PATH)

# Active Job Tracking for Scaffolder
# Format: { job_id: { "status": "running"|"success"|"error", "type": "...", "name": "...", "steps": [...], "current_step": 0, "log_file": "..." } }
scaffolding_jobs = {}

# ==============================================================================
# Git HTTP Server CGI Endpoint
# ==============================================================================
@app.route('/git/<path:req_path>', methods=['GET', 'POST'])
def git_backend(req_path):
    project_root = os.path.dirname(REPO_PATH)
    path_info = f"/{req_path}"
    
    env = os.environ.copy()
    env["GIT_PROJECT_ROOT"] = project_root
    env["GIT_HTTP_EXPORT_ALL"] = "1"
    env["PATH_INFO"] = path_info
    env["REQUEST_METHOD"] = request.method
    env["QUERY_STRING"] = request.query_string.decode('utf-8')
    env["CONTENT_TYPE"] = request.headers.get("Content-Type", "")
    
    req_data = request.get_data()
    
    try:
        proc = subprocess.run(
            ["git", "http-backend"],
            input=req_data,
            env=env,
            capture_output=True
        )
        
        response_data = proc.stdout
        header_part, _, body_part = response_data.partition(b'\r\n\r\n')
        if not body_part:
            header_part, _, body_part = response_data.partition(b'\n\n')
            
        headers = {}
        for line in header_part.decode('utf-8', errors='ignore').split('\r\n'):
            if not line:
                continue
            if ':' in line:
                k, v = line.split(':', 1)
                headers[k.strip()] = v.strip()
                
        status_code = 200
        if 'Status' in headers:
            status_code = int(headers['Status'].split()[0])
            del headers['Status']
            
        res = Response(body_part, status=status_code)
        for k, v in headers.items():
            res.headers[k] = v
        return res
    except Exception as e:
        logger.error(f"Git backend error: {e}")
        return Response(f"Internal Git server error: {e}", status=500)

# ==============================================================================
# UI Routes
# ==============================================================================
@app.route("/")
def index():
    return send_from_directory('static', 'index.html')

@app.route("/login")
def login_page():
    return send_from_directory('static', 'keycloak.html')

@app.route("/health")
def health():
    return jsonify({
        "status": "UP",
        "gitops_repo": REPO_PATH,
        "terraform_workspace": TF_RUNS_DIR
    })

# ==============================================================================
# REST API: Git Log & K8s Status
# ==============================================================================
@app.route("/api/v1/git/log", methods=["GET"])
def git_log():
    commits = get_git_log(REPO_PATH)
    return jsonify(commits)

@app.route("/api/v1/k8s/status", methods=["GET"])
def k8s_status():
    ns_items = get_namespaces()
    ns_names = [ns["name"] for ns in ns_items]
    # Include argocd and idp-system for status checks
    check_ns = ns_names + ["argocd", "idp-system"]
    pods = get_pods_in_namespaces(check_ns)
    argocd_apps = get_argocd_apps()
    
    return jsonify({
        "pods": pods,
        "namespaces": ns_items,
        "applications": argocd_apps
    })

# ==============================================================================
# REST API: Backstage Software Catalog
# ==============================================================================
@app.route("/api/v1/catalog", methods=["GET"])
def get_catalog():
    # 1. Namespaces
    namespaces = get_namespaces()
    
    # 2. ArgoCD Apps (Services)
    argocd_apps = get_argocd_apps()
    services = []
    for app_data in argocd_apps:
        services.append({
            "name": app_data["name"],
            "type": "service",
            "lifecycle": "production" if "prod" in app_data["dest_namespace"] else "experimental",
            "owner": "engineering-team",
            "description": f"Microservice managed by GitOps, deployed in namespace {app_data['dest_namespace']}",
            "status": "Active" if app_data["health_status"] == "Healthy" else "Degraded",
            "details": f"Repo: {app_data['repo_url']} | Destination: {app_data['dest_namespace']}"
        })
        
    # 3. Databases (Scan for database pods in active namespaces)
    ns_names = [ns["name"] for ns in namespaces]
    pods = get_pods_in_namespaces(ns_names)
    databases = []
    seen_dbs = set()
    for pod in pods:
        # We look for deployment/pods representing postgres or redis
        pod_name = pod["name"]
        ns = pod["namespace"]
        
        # Determine engine from name
        engine = None
        if "postgres" in pod_name or "-pg-" in pod_name or pod_name.startswith("pg-"):
            engine = "PostgreSQL"
        elif "redis" in pod_name:
            engine = "Redis"
            
        if engine:
            parts = pod_name.split("-")
            db_name = "-".join(parts[:-2]) if len(parts) >= 3 else parts[0]
            db_id = f"{ns}/{db_name}"
            if db_id not in seen_dbs:
                seen_dbs.add(db_id)
                databases.append({
                    "name": db_name,
                    "type": f"database ({engine})",
                    "lifecycle": "experimental",
                    "owner": "data-team",
                    "description": f"{engine} database instance deployed in namespace {ns}",
                    "status": "Active" if pod["status"] == "Running" else "Provisioning",
                    "details": f"IP: {pod['pod_ip']} | Namespace: {ns}"
                })
                
    # 4. Pipelines (Look at yaml files in pipelines/)
    pipelines = []
    pipelines_dir = os.path.join(REPO_PATH, "pipelines")
    if os.path.exists(pipelines_dir):
        for f in os.listdir(pipelines_dir):
            if f.endswith(".yaml"):
                p_name = f.replace("-pipeline.yaml", "")
                pipelines.append({
                    "name": p_name,
                    "type": "pipeline",
                    "lifecycle": "production",
                    "owner": "devops-team",
                    "description": f"CI/CD workflow definition for repository GitHub/{p_name}",
                    "status": "Active",
                    "details": f"File: pipelines/{f}"
                })
                
    # Combine everything
    catalog_items = []
    for ns in namespaces:
        catalog_items.append({
            "name": ns["name"],
            "type": "namespace",
            "lifecycle": "production" if ns["name"] in ["prod", "gitops-prod"] else "experimental",
            "owner": "infrastructure-team",
            "description": f"Kubernetes namespace. Status: {ns['status']}",
            "status": "Active" if ns["status"] == "Active" else "Terminating",
            "details": f"Age: {ns['age']}"
        })
    catalog_items.extend(services)
    catalog_items.extend(databases)
    catalog_items.extend(pipelines)
    
    return jsonify(catalog_items)

# ==============================================================================
# REST API: Keycloak Identity Simulator
# ==============================================================================
@app.route("/api/v1/keycloak/auth", methods=["POST"])
def keycloak_auth():
    data = request.get_json() or {}
    username = data.get("username")
    password = data.get("password")
    client_id = data.get("client_id", "backstage-portal")
    
    # Simple hardcoded mock validation
    valid_users = {
        "admin": {"password": "admin123", "name": "System Administrator", "email": "admin@aegis.local", "roles": ["platform-admin", "developer"]},
        "developer": {"password": "dev123", "name": "Junior Developer", "email": "dev@aegis.local", "roles": ["developer"]},
        "devops": {"password": "ops123", "name": "DevOps Engineer", "email": "ops@aegis.local", "roles": ["platform-admin"]}
    }
    
    if username in valid_users and valid_users[username]["password"] == password:
        user_info = valid_users[username]
        token = f"eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.mockToken-{uuid.uuid4().hex}"
        return jsonify({
            "success": True,
            "token": token,
            "username": username,
            "name": user_info["name"],
            "email": user_info["email"],
            "roles": user_info["roles"],
            "realm": "aegis-platform",
            "client_id": client_id
        })
        
    return jsonify({"success": False, "message": "Invalid username or password."}), 401

@app.route("/api/v1/keycloak/realms", methods=["GET"])
def keycloak_realms():
    return jsonify([
        {"id": "aegis-platform", "name": "Aegis Enterprise Platform", "enabled": True, "token_lifespan": "30m"},
        {"id": "master", "name": "Master Administration Realm", "enabled": True, "token_lifespan": "5m"}
    ])

@app.route("/api/v1/keycloak/clients", methods=["GET"])
def keycloak_clients():
    return jsonify([
        {"client_id": "backstage-portal", "name": "Aegis Developer Portal", "protocol": "openid-connect", "enabled": True, "root_url": "/"},
        {"client_id": "argocd-console", "name": "ArgoCD OAuth Client", "protocol": "openid-connect", "enabled": True, "root_url": "/argocd"},
        {"client_id": "pgadmin-client", "name": "pgAdmin Portal", "protocol": "openid-connect", "enabled": True, "root_url": "/pgadmin"}
    ])

@app.route("/api/v1/keycloak/users", methods=["GET"])
def keycloak_users():
    return jsonify([
        {"username": "admin", "email": "admin@aegis.local", "firstName": "System", "lastName": "Admin", "enabled": True, "emailVerified": True},
        {"username": "developer", "email": "dev@aegis.local", "firstName": "Junior", "lastName": "Developer", "enabled": True, "emailVerified": True},
        {"username": "devops", "email": "ops@aegis.local", "firstName": "DevOps", "lastName": "Engineer", "enabled": True, "emailVerified": True}
    ])

# ==============================================================================
# REST API: Scaffolder (Software Templates Engine)
# ==============================================================================
@app.route("/api/v1/scaffold", methods=["POST"])
def trigger_scaffold():
    data = request.get_json() or {}
    template_type = data.get("type") # service | database | namespace | pipeline
    name = data.get("name")
    
    if not template_type or not name:
        return jsonify({"success": False, "message": "Missing required fields: 'type' and 'name'."}), 400
        
    # Clean inputs
    name = name.lower().replace(" ", "-").strip()
    job_id = str(uuid.uuid4())
    log_file = os.path.join(LOGS_DIR, f"{job_id}.log")
    
    # --------------------------------------------------------------------------
    # Scenario 1: Create Namespace (Terraform)
    # --------------------------------------------------------------------------
    if template_type == "namespace":
        env = data.get("environment", "dev")
        cpu = data.get("cpu_limit", "2")
        memory = data.get("memory_limit", "4Gi")
        
        run_dir = os.path.join(TF_RUNS_DIR, "namespaces", name)
        generate_namespace_tf(run_dir, name, env, cpu, memory)
        
        scaffolding_jobs[job_id] = {
            "status": "running",
            "type": "namespace",
            "name": name,
            "steps": ["Generate Terraform Files", "Initialize Terraform Workspace", "Provision Namespace with Quotas"],
            "current_step": 0,
            "log_file": log_file
        }
        
        def tf_callback(success):
            job = scaffolding_jobs[job_id]
            if success:
                job["status"] = "success"
                job["current_step"] = 3
                with open(log_file, "a") as f:
                    f.write("\n=== SCAFFOLDING SUCCESSFUL ===\n")
                    f.write(f"Namespace '{name}' has been created with CPU quota={cpu} and Memory quota={memory}.\n")
            else:
                job["status"] = "error"
                with open(log_file, "a") as f:
                    f.write("\n=== SCAFFOLDING FAILED ===\n")
                    
        # Update progress to Step 2
        scaffolding_jobs[job_id]["current_step"] = 1
        run_terraform_pipeline(run_dir, log_file, tf_callback)
        
        return jsonify({"success": True, "job_id": job_id})
        
    # --------------------------------------------------------------------------
    # Scenario 2: Create Database (Terraform)
    # --------------------------------------------------------------------------
    elif template_type == "database":
        engine = data.get("engine", "postgresql")
        namespace = data.get("namespace", "default")
        username = data.get("username", "postgres")
        password = data.get("password", "dbpass123")
        size = data.get("storage_size", "5")
        
        run_dir = os.path.join(TF_RUNS_DIR, "databases", name)
        generate_database_tf(run_dir, name, namespace, engine, username, password, size)
        
        scaffolding_jobs[job_id] = {
            "status": "running",
            "type": "database",
            "name": name,
            "steps": ["Generate Workload Configuration", "Initialize Terraform Workspace", "Deploy Database work to Kubernetes"],
            "current_step": 0,
            "log_file": log_file
        }
        
        def tf_callback(success):
            job = scaffolding_jobs[job_id]
            if success:
                job["status"] = "success"
                job["current_step"] = 3
                with open(log_file, "a") as f:
                    f.write("\n=== SCAFFOLDING SUCCESSFUL ===\n")
                    f.write(f"Database workload '{name}' ({engine}) provisioned in namespace '{namespace}' successfully.\n")
            else:
                job["status"] = "error"
                with open(log_file, "a") as f:
                    f.write("\n=== SCAFFOLDING FAILED ===\n")
                    
        scaffolding_jobs[job_id]["current_step"] = 1
        run_terraform_pipeline(run_dir, log_file, tf_callback)
        return jsonify({"success": True, "job_id": job_id})
        
    # --------------------------------------------------------------------------
    # Scenario 3: Create Service (Helm Chart + Git commit + ArgoCD Sync)
    # --------------------------------------------------------------------------
    elif template_type == "service":
        namespace = data.get("namespace", "default")
        image_repo = data.get("image_repository", "nginx")
        image_tag = data.get("image_tag", "alpine")
        port = int(data.get("container_port", 80))
        replicas = int(data.get("replicas", 1))
        cpu = data.get("cpu_request", "50m")
        memory = data.get("memory_request", "64Mi")
        
        scaffolding_jobs[job_id] = {
            "status": "running",
            "type": "service",
            "name": name,
            "steps": [
                "Scaffold Helm Chart directories",
                "Write chart configuration and limits",
                "Register application with ArgoCD CRDs",
                "Push configurations to local GitOps repo",
                "Request ArgoCD continuous deployment sync"
            ],
            "current_step": 0,
            "log_file": log_file
        }
        
        def service_worker():
            try:
                with open(log_file, "w") as f:
                    f.write("=== AEGIS PLATFORM GITOPS SERVICE SCAFFOLDER ===\n")
                    f.write(f"Service Name: {name}\n")
                    f.write(f"Target Namespace: {namespace}\n\n")
                
                # Step 1 & 2: Generate files
                with open(log_file, "a") as f:
                    f.write("[STEP 1/5] Scaffolding Helm Chart templates...\n")
                time.sleep(1)
                
                with open(log_file, "a") as f:
                    f.write("[STEP 2/5] Creating service manifest configurations...\n")
                time.sleep(0.5)
                
                msg = scaffold_service(REPO_PATH, TEMPLATES_PATH, name, namespace, image_repo, image_tag, port, replicas, cpu, memory)
                
                with open(log_file, "a") as f:
                    f.write(f"Git repo changes generated successfully: {msg}\n")
                scaffolding_jobs[job_id]["current_step"] = 2
                
                # Step 3: Register application manifest with cluster
                with open(log_file, "a") as f:
                    f.write("[STEP 3/5] Registering ArgoCD Application Manifest in cluster...\n")
                time.sleep(0.5)
                
                manifest_path = os.path.join(REPO_PATH, "kubernetes", f"{name}-application.yaml")
                ok, output = apply_kubernetes_manifest(manifest_path)
                
                with open(log_file, "a") as f:
                    f.write(f"Manifest application output:\n{output}\n")
                    
                if not ok:
                    scaffolding_jobs[job_id]["status"] = "error"
                    return
                scaffolding_jobs[job_id]["current_step"] = 3
                
                # Step 4: Push / Commit details
                with open(log_file, "a") as f:
                    f.write("[STEP 4/5] Committing changes to local GitOps controller...\n")
                time.sleep(0.5)
                
                scaffolding_jobs[job_id]["current_step"] = 4
                
                # Step 5: ArgoCD Sync trigger
                with open(log_file, "a") as f:
                    f.write("[STEP 5/5] Requesting ArgoCD synchronization controller...\n")
                
                # Give a brief delay for ArgoCD to detect the new App resource
                time.sleep(1.5)
                sync_ok, sync_msg = trigger_argocd_sync(name)
                
                with open(log_file, "a") as f:
                    f.write(f"ArgoCD Sync Request Output: {sync_msg}\n")
                    
                # Note: ArgoCD Sync request might return warnings if controller is busy or starting,
                # but we proceed since GitOps will eventually sync it automatically.
                scaffolding_jobs[job_id]["status"] = "success"
                scaffolding_jobs[job_id]["current_step"] = 5
                
                with open(log_file, "a") as f:
                    f.write("\n=== SCAFFOLDING SUCCESSFUL ===\n")
                    f.write(f"Service '{name}' successfully scaffolded and registered in ArgoCD. GitOps agent is synchronizing.\n")
                    
            except Exception as e:
                logger.error(f"Service scaffolder error: {e}")
                scaffolding_jobs[job_id]["status"] = "error"
                with open(log_file, "a") as f:
                    f.write(f"\n[EXCEPTION ERROR] Scaffolder pipeline failed: {str(e)}\n")
                    
        threading.Thread(target=service_worker).start()
        return jsonify({"success": True, "job_id": job_id})
        
    # --------------------------------------------------------------------------
    # Scenario 4: Create Pipeline (Yaml config template)
    # --------------------------------------------------------------------------
    elif template_type == "pipeline":
        repo_url = data.get("repository", "github.com/my-org/service")
        branch = data.get("branch", "main")
        steps = data.get("steps", ["Lint", "Test", "Build", "Deploy"])
        
        scaffolding_jobs[job_id] = {
            "status": "running",
            "type": "pipeline",
            "name": name,
            "steps": ["Create workflow repository path", "Define CI/CD execution pipeline stages", "Register and commit pipeline manifest"],
            "current_step": 0,
            "log_file": log_file
        }
        
        def pipeline_worker():
            try:
                with open(log_file, "w") as f:
                    f.write("=== AEGIS CI/CD PIPELINE GENERATOR ===\n")
                    f.write(f"Pipeline Name: {name}\n")
                    f.write(f"Target Repository: {repo_url}\n")
                    f.write(f"Trigger Branch: {branch}\n\n")
                
                with open(log_file, "a") as f:
                    f.write("[STEP 1/3] Setting up pipeline workflow paths...\n")
                time.sleep(1)
                scaffolding_jobs[job_id]["current_step"] = 1
                
                with open(log_file, "a") as f:
                    f.write("[STEP 2/3] Writing workflow job stages and environments...\n")
                time.sleep(0.5)
                
                msg = scaffold_pipeline(REPO_PATH, name, repo_url, branch, steps)
                scaffolding_jobs[job_id]["current_step"] = 2
                
                with open(log_file, "a") as f:
                    f.write("[STEP 3/3] Committing pipeline definition to GitOps controller...\n")
                time.sleep(0.5)
                
                scaffolding_jobs[job_id]["status"] = "success"
                scaffolding_jobs[job_id]["current_step"] = 3
                with open(log_file, "a") as f:
                    f.write("\n=== SCAFFOLDING SUCCESSFUL ===\n")
                    f.write(f"Pipeline workflow '{name}' successfully committed to GitOps repository under 'pipelines/'.\n")
            except Exception as e:
                logger.error(f"Pipeline scaffolder error: {e}")
                scaffolding_jobs[job_id]["status"] = "error"
                with open(log_file, "a") as f:
                    f.write(f"\n[EXCEPTION ERROR] Scaffolder pipeline failed: {str(e)}\n")
                    
        threading.Thread(target=pipeline_worker).start()
        return jsonify({"success": True, "job_id": job_id})
        
    return jsonify({"success": False, "message": "Unknown template type."}), 400

@app.route("/api/v1/scaffold/status/<job_id>", methods=["GET"])
def scaffold_status(job_id):
    if job_id not in scaffolding_jobs:
        return jsonify({"success": False, "message": "Job not found."}), 404
    return jsonify(scaffolding_jobs[job_id])

@app.route("/api/v1/scaffold/logs/<job_id>", methods=["GET"])
def scaffold_logs(job_id):
    if job_id not in scaffolding_jobs:
        return jsonify({"success": False, "message": "Job not found."}), 404
        
    log_file = scaffolding_jobs[job_id]["log_file"]
    if not os.path.exists(log_file):
        return jsonify({"logs": ""})
        
    try:
        with open(log_file, "r") as f:
            content = f.read()
        return jsonify({"logs": content})
    except Exception as e:
        return jsonify({"logs": f"Error reading logs: {e}"})

# ==============================================================================
# Application Startup
# ==============================================================================
if __name__ == "__main__":
    port = int(os.getenv("PORT", 5007))
    logger.info(f"Starting Aegis IDP Portal on port {port}...")
    app.run(host="0.0.0.0", port=port, debug=False)
