import os
import subprocess
import threading
import logging

logger = logging.getLogger("tf-utils")

def execute_tf_cmd(cmd, run_dir, log_file):
    try:
        with open(log_file, "a") as f:
            f.write(f"\n$ {' '.join(cmd)}\n")
            f.flush()
            
            proc = subprocess.Popen(
                cmd,
                cwd=run_dir,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True
            )
            
            for line in proc.stdout:
                f.write(line)
                f.flush()
                
            proc.wait()
            if proc.returncode != 0:
                f.write(f"\n[ERROR] Command failed with exit code {proc.returncode}\n")
                return False
            f.write(f"\n[SUCCESS] Command executed successfully.\n")
            return True
    except Exception as e:
        logger.error(f"Error running Terraform command {' '.join(cmd)}: {e}")
        with open(log_file, "a") as f:
            f.write(f"\n[EXCEPTION ERROR] {str(e)}\n")
        return False

def run_terraform_pipeline(run_dir, log_file, callback=None):
    def worker():
        try:
            with open(log_file, "w") as f:
                f.write("=== AEGIS PLATFORM TERRAFORM PIPELINE RUN ===\n")
                f.write(f"Workspace: {run_dir}\n\n")
            
            # Step 1: Init
            with open(log_file, "a") as f:
                f.write("[STEP 1/2] Initializing Terraform...\n")
            
            success = execute_tf_cmd(["terraform", "init"], run_dir, log_file)
            if not success:
                if callback: callback(False)
                return
                
            # Step 2: Apply
            with open(log_file, "a") as f:
                f.write("\n[STEP 2/2] Applying Infrastructure Changes...\n")
                
            success = execute_tf_cmd(["terraform", "apply", "-auto-approve"], run_dir, log_file)
            
            if callback:
                callback(success)
        except Exception as e:
            logger.error(f"Worker thread error: {e}")
            if callback: callback(False)

    t = threading.Thread(target=worker)
    t.start()
    return t

def generate_namespace_tf(run_dir, name, env, cpu_limit, mem_limit):
    os.makedirs(run_dir, exist_ok=True)
    
    tf_content = f"""terraform {{
  required_providers {{
    kubernetes = {{
      source  = "hashicorp/kubernetes"
      version = "~> 2.26"
    }}
  }}
}}

provider "kubernetes" {{
  # Automatically uses in-cluster config or local kubeconfig
}}

resource "kubernetes_namespace" "ns" {{
  metadata {{
    name = "{name}"
    labels = {{
      "managed-by" = "aegis-idp"
      "environment" = "{env}"
    }}
  }}
}}

resource "kubernetes_resource_quota" "quota" {{
  metadata {{
    name      = "ns-quota"
    namespace = kubernetes_namespace.ns.metadata[0].name
  }}
  spec {{
    hard = {{
      cpu    = "{cpu_limit}"
      memory = "{mem_limit}"
      pods   = "15"
    }}
  }}
}}
"""
    with open(os.path.join(run_dir, "main.tf"), "w") as f:
        f.write(tf_content)

def generate_database_tf(run_dir, name, namespace, engine, username, password, size_gb):
    os.makedirs(run_dir, exist_ok=True)
    
    if engine.lower() == "redis":
        tf_content = f"""terraform {{
  required_providers {{
    kubernetes = {{
      source  = "hashicorp/kubernetes"
      version = "~> 2.26"
    }}
  }}
}}

provider "kubernetes" {{}}

resource "kubernetes_deployment" "redis" {{
  metadata {{
    name      = "{name}"
    namespace = "{namespace}"
    labels = {{
      app    = "{name}"
      engine = "redis"
      type   = "database"
    }}
  }}
  spec {{
    replicas = 1
    selector {{
      match_labels = {{
        app = "{name}"
      }}
    }}
    template {{
      metadata {{
        labels = {{
          app = "{name}"
        }}
      }}
      spec {{
        container {{
          name  = "redis"
          image = "redis:7-alpine"
          port {{
            container_port = 6379
          }}
          resources {{
            requests = {{
              cpu    = "50m"
              memory = "64Mi"
            }}
            limits = {{
              cpu    = "150m"
              memory = "128Mi"
            }}
          }}
        }}
      }}
    }}
  }}
}}

resource "kubernetes_service" "redis_service" {{
  metadata {{
    name      = "{name}"
    namespace = "{namespace}"
  }}
  spec {{
    selector = {{
      app = "{name}"
    }}
    port {{
      port        = 6379
      target_port = 6379
    }}
    type = "ClusterIP"
  }}
}}
"""
    else:  # postgresql
        tf_content = f"""terraform {{
  required_providers {{
    kubernetes = {{
      source  = "hashicorp/kubernetes"
      version = "~> 2.26"
    }}
  }}
}}

provider "kubernetes" {{}}

resource "kubernetes_secret" "db_secret" {{
  metadata {{
    name      = "{name}-secret"
    namespace = "{namespace}"
  }}
  data = {{
    POSTGRES_USER     = "{username}"
    POSTGRES_PASSWORD = "{password}"
    POSTGRES_DB       = "{name}"
  }}
}}

resource "kubernetes_deployment" "postgres" {{
  metadata {{
    name      = "{name}"
    namespace = "{namespace}"
    labels = {{
      app    = "{name}"
      engine = "postgresql"
      type   = "database"
    }}
  }}
  spec {{
    replicas = 1
    selector {{
      match_labels = {{
        app = "{name}"
      }}
    }}
    template {{
      metadata {{
        labels = {{
          app = "{name}"
        }}
      }}
      spec {{
        container {{
          name  = "postgres"
          image = "postgres:15-alpine"
          port {{
            container_port = 5432
          }}
          env {{
            name = "POSTGRES_USER"
            value_from {{
              secret_key_ref {{
                name = kubernetes_secret.db_secret.metadata[0].name
                key  = "POSTGRES_USER"
              }}
            }}
          }}
          env {{
            name = "POSTGRES_PASSWORD"
            value_from {{
              secret_key_ref {{
                name = kubernetes_secret.db_secret.metadata[0].name
                key  = "POSTGRES_PASSWORD"
              }}
            }}
          }}
          env {{
            name = "POSTGRES_DB"
            value_from {{
              secret_key_ref {{
                name = kubernetes_secret.db_secret.metadata[0].name
                key  = "POSTGRES_DB"
              }}
            }}
          }}
          resources {{
            requests = {{
              cpu    = "50m"
              memory = "64Mi"
            }}
            limits = {{
              cpu    = "200m"
              memory = "128Mi"
            }}
          }}
        }}
      }}
    }}
  }}
}}

resource "kubernetes_service" "postgres_service" {{
  metadata {{
    name      = "{name}"
    namespace = "{namespace}"
  }}
  spec {{
    selector = {{
      app = "{name}"
    }}
    port {{
      port        = 5432
      target_port = 5432
    }}
    type = "ClusterIP"
  }}
}}
"""
    with open(os.path.join(run_dir, "main.tf"), "w") as f:
        f.write(tf_content)
