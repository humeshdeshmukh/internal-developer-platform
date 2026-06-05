import datetime
import logging
import subprocess
from kubernetes import client, config

logger = logging.getLogger("k8s-utils")

def get_k8s_clients():
    try:
        config.load_incluster_config()
    except Exception as e:
        logger.warning(f"Could not load in-cluster config, trying local kubeconfig: {e}")
        try:
            config.load_kube_config()
        except Exception as ex:
            logger.error(f"Failed to load any Kubernetes configuration: {ex}")
            return None, None
            
    v1 = client.CoreV1Api()
    custom = client.CustomObjectsApi()
    return v1, custom

def format_age(creation_timestamp):
    if not creation_timestamp:
        return "unknown"
    try:
        now = datetime.datetime.now(datetime.timezone.utc)
        if creation_timestamp.tzinfo is None:
            creation_timestamp = creation_timestamp.replace(tzinfo=datetime.timezone.utc)
        delta = now - creation_timestamp
        seconds = delta.total_seconds()
        
        if seconds < 60:
            return f"{int(seconds)}s"
        minutes = seconds / 60
        if minutes < 60:
            return f"{int(minutes)}m"
        hours = minutes / 60
        if hours < 24:
            return f"{int(hours)}h"
        return f"{int(hours / 24)}d"
    except Exception as e:
        logger.warning(f"Error formatting age: {e}")
        return "unknown"

def get_namespaces():
    v1, _ = get_k8s_clients()
    if not v1:
        return []
    try:
        ns_list = v1.list_namespace()
        namespaces = []
        for ns in ns_list.items:
            name = ns.metadata.name
            # Filter out standard system namespaces to keep the catalog clean, but keep default
            if name in ["kube-system", "kube-public", "kube-node-lease", "ingress-nginx", "kubernetes-dashboard"]:
                continue
            namespaces.append({
                "name": name,
                "status": ns.status.phase,
                "age": format_age(ns.metadata.creation_timestamp)
            })
        return namespaces
    except Exception as e:
        logger.warning(f"Failed to list namespaces: {e}")
        return []

def get_pods_in_namespaces(namespaces):
    v1, _ = get_k8s_clients()
    if not v1:
        return []
        
    pods_info = []
    for ns in namespaces:
        try:
            pods = v1.list_namespaced_pod(ns)
            for pod in pods.items:
                cpu_req = "N/A"
                mem_req = "N/A"
                if pod.spec.containers:
                    cpu_sum = 0
                    mem_sum = 0
                    has_cpu = False
                    has_mem = False
                    for container in pod.spec.containers:
                        if container.resources and container.resources.requests:
                            req = container.resources.requests
                            if "cpu" in req:
                                has_cpu = True
                                cpu_val = req["cpu"]
                                if cpu_val.endswith("m"):
                                    cpu_sum += int(cpu_val[:-1])
                                else:
                                    cpu_sum += int(float(cpu_val) * 1000)
                            if "memory" in req:
                                has_mem = True
                                mem_val = req["memory"]
                                if mem_val.endswith("Mi"):
                                    mem_sum += int(mem_val[:-2])
                                elif mem_val.endswith("Gi"):
                                    mem_sum += int(mem_val[:-2]) * 1024
                                elif mem_val.endswith("Ki"):
                                    mem_sum += int(mem_val[:-2]) // 1024
                                else:
                                    try:
                                        mem_sum += int(mem_val) // (1024 * 1024)
                                    except:
                                        pass
                    if has_cpu:
                        cpu_req = f"{cpu_sum}m"
                    if has_mem:
                        mem_req = f"{mem_sum}Mi"
                        
                pods_info.append({
                    "name": pod.metadata.name,
                    "namespace": pod.metadata.namespace,
                    "status": pod.status.phase,
                    "pod_ip": pod.status.pod_ip or "N/A",
                    "cpu_request": cpu_req,
                    "memory_request": mem_req,
                    "age": format_age(pod.metadata.creation_timestamp)
                })
        except Exception as e:
            logger.warning(f"Failed to list pods in namespace {ns}: {e}")
            
    return pods_info

def get_argocd_apps():
    _, custom = get_k8s_clients()
    if not custom:
        return []
        
    try:
        apps = custom.list_namespaced_custom_object(
            group="argoproj.io",
            version="v1alpha1",
            namespace="argocd",
            plural="applications"
        )
        apps_info = []
        for item in apps.get("items", []):
            metadata = item.get("metadata", {})
            spec = item.get("spec", {})
            status = item.get("status", {})
            
            sync = status.get("sync", {})
            health = status.get("health", {})
            
            apps_info.append({
                "name": metadata.get("name"),
                "namespace": metadata.get("namespace"),
                "sync_status": sync.get("status", "Unknown"),
                "health_status": health.get("status", "Unknown"),
                "repo_url": spec.get("source", {}).get("repoURL"),
                "path": spec.get("source", {}).get("path"),
                "target_revision": spec.get("source", {}).get("targetRevision"),
                "dest_namespace": spec.get("destination", {}).get("namespace"),
                "synced_revision": sync.get("revision", "N/A")[:7] if sync.get("revision") else "N/A"
            })
        return apps_info
    except Exception as e:
        logger.warning(f"Failed to fetch ArgoCD applications: {e}")
        return []

def trigger_argocd_sync(app_name):
    _, custom = get_k8s_clients()
    if not custom:
        return False, "K8s client not available"
        
    try:
        patch_body = {
            "operation": {
                "initiatedBy": {
                    "username": "aegis-idp"
                },
                "sync": {
                    "prune": True,
                    "syncOptions": ["CreateNamespace=true"]
                }
            }
        }
        
        custom.patch_namespaced_custom_object(
            group="argoproj.io",
            version="v1alpha1",
            namespace="argocd",
            plural="applications",
            name=app_name,
            body=patch_body
        )
        return True, "Sync request sent successfully"
    except Exception as e:
        logger.error(f"Failed to trigger sync for ArgoCD app {app_name}: {e}")
        return False, str(e)

def apply_kubernetes_manifest(manifest_path):
    try:
        cmd = ["kubectl", "apply", "-f", manifest_path]
        logger.info(f"Executing: {' '.join(cmd)}")
        res = subprocess.run(cmd, capture_output=True, text=True, check=True)
        return True, res.stdout
    except subprocess.CalledProcessError as e:
        logger.error(f"Failed to apply manifest {manifest_path}: {e.stderr}")
        return False, e.stderr
