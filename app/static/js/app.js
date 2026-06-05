document.addEventListener("DOMContentLoaded", () => {
  // ==========================================================================
  // SSO Authorization Check
  // ==========================================================================
  const token = localStorage.getItem("kc_token");
  if (!token) {
    window.location.href = "/keycloak.html?client_id=backstage-portal";
    return;
  }

  // Populate user profile info in sidebar
  const username = localStorage.getItem("kc_username") || "admin";
  const name = localStorage.getItem("kc_name") || "System Admin";
  const email = localStorage.getItem("kc_email") || "admin@aegis.local";
  const roles = JSON.parse(localStorage.getItem("kc_roles") || '["platform-admin"]');

  document.getElementById("profileName").innerText = name;
  document.getElementById("profileRole").innerText = roles.includes("platform-admin") ? "Platform Admin" : "Developer";
  document.getElementById("profileAvatar").innerText = name.split(" ").map(n => n[0]).join("").toUpperCase();

  // Logout functionality
  document.getElementById("btnSidebarLogout").addEventListener("click", () => {
    localStorage.removeItem("kc_token");
    localStorage.removeItem("kc_username");
    localStorage.removeItem("kc_name");
    localStorage.removeItem("kc_email");
    localStorage.removeItem("kc_roles");
    window.location.href = "/keycloak.html?client_id=backstage-portal";
  });

  // ==========================================================================
  // Navigation Tabs Switching
  // ==========================================================================
  const navItems = document.querySelectorAll(".nav-item");
  const tabPanes = document.querySelectorAll(".tab-pane");

  navItems.forEach(item => {
    item.addEventListener("click", () => {
      const targetTab = item.getAttribute("data-tab");
      
      navItems.forEach(n => n.classList.remove("active"));
      tabPanes.forEach(t => t.classList.remove("active"));

      item.classList.add("active");
      document.getElementById(targetTab).classList.add("active");

      // Reload appropriate data on tab change
      if (targetTab === "catalog-tab") {
        loadCatalog();
      } else if (targetTab === "argocd-tab") {
        loadK8sStatus();
      } else if (targetTab === "keycloak-tab") {
        loadKeycloakSettings();
      } else if (targetTab === "portfolio-tab") {
        loadPortfolioDetails(7);
      }
    });
  });

  // ==========================================================================
  // Catalog Load & Filtering
  // ==========================================================================
  let catalogItems = [];

  async function loadCatalog() {
    try {
      const response = await fetch("/api/v1/catalog");
      catalogItems = await response.json();
      renderCatalog(catalogItems);
    } catch (err) {
      console.error("Failed to load catalog data:", err);
    }
  }

  function renderCatalog(items) {
    const tableBody = document.getElementById("catalogTableBody");
    tableBody.innerHTML = "";

    if (items.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-dim); padding: 40px;">No software components found in the catalog.</td></tr>`;
      return;
    }

    items.forEach(item => {
      const tr = document.createElement("tr");

      // Select icon based on type
      let icon = "";
      if (item.type.includes("service")) {
        icon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
      } else if (item.type.includes("database")) {
        icon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"></path></svg>`;
      } else if (item.type.includes("namespace")) {
        icon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>`;
      } else {
        icon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"></line><line x1="4" y1="10" x2="4" y2="3"></line><line x1="12" y1="21" x2="12" y2="12"></line><line x1="12" y1="8" x2="12" y2="3"></line><line x1="20" y1="21" x2="20" y2="16"></line><line x1="20" y1="12" x2="20" y2="3"></line><line x1="1" y1="14" x2="7" y2="14"></line><line x1="9" y1="8" x2="15" y2="8"></line><line x1="17" y1="16" x2="23" y2="16"></line></svg>`;
      }

      // Determine badge class
      let badgeClass = "type-service";
      if (item.type.includes("database")) badgeClass = "type-database";
      else if (item.type.includes("namespace")) badgeClass = "type-namespace";
      else if (item.type.includes("pipeline")) badgeClass = "type-pipeline";

      // Status class
      let statusClass = "status-active";
      if (item.status === "Degraded" || item.status === "Terminating") statusClass = "status-degraded";
      else if (item.status === "Provisioning") statusClass = "status-pending";

      tr.innerHTML = `
        <td>
          <div class="catalog-item-name">
            <span class="item-icon">${icon}</span>
            <span>${item.name}</span>
          </div>
        </td>
        <td><span class="type-badge ${badgeClass}">${item.type}</span></td>
        <td><span class="status-indicator ${statusClass}">${item.status}</span></td>
        <td>${item.description}</td>
        <td><span style="font-family: var(--font-mono); font-size: 11px; color: var(--text-dim);">${item.details}</span></td>
      `;
      tableBody.appendChild(tr);
    });
  }

  // Filter Catalog
  const searchInput = document.getElementById("catalogSearch");
  const filterSelect = document.getElementById("catalogFilter");

  function filterCatalog() {
    const query = searchInput.value.toLowerCase();
    const typeFilter = filterSelect.value;

    const filtered = catalogItems.filter(item => {
      const matchesSearch = item.name.toLowerCase().includes(query) || item.description.toLowerCase().includes(query);
      const matchesType = typeFilter === "all" || item.type.includes(typeFilter);
      return matchesSearch && matchesType;
    });
    renderCatalog(filtered);
  }

  searchInput.addEventListener("input", filterCatalog);
  filterSelect.addEventListener("change", filterCatalog);

  // Initialize Catalog
  loadCatalog();

  // ==========================================================================
  // ArgoCD Sync Monitor & Cluster Status Load
  // ==========================================================================
  async function loadK8sStatus() {
    try {
      const response = await fetch("/api/v1/k8s/status");
      const data = await response.json();
      
      // Update Pods Grid
      const podsGrid = document.getElementById("k8sPodsGrid");
      podsGrid.innerHTML = "";

      if (data.pods.length === 0) {
        podsGrid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--text-dim); padding: 30px;">No application pods running in developer namespaces.</div>`;
      } else {
        data.pods.forEach(pod => {
          const card = document.createElement("div");
          card.className = "template-card glass-panel";
          
          let podStatusClass = "status-active";
          if (pod.status !== "Running") podStatusClass = "status-pending";
          
          card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 15px;">
              <span style="font-family: var(--font-title); font-weight: 700; font-size: 16px; word-break: break-all;">${pod.name}</span>
              <span class="status-indicator ${podStatusClass}" style="font-size: 11px;">${pod.status}</span>
            </div>
            <div style="font-size: 12px; color: var(--text-muted); display: flex; flex-direction: column; gap: 6px;">
              <div>Namespace: <strong style="color: var(--text-main);">${pod.namespace}</strong></div>
              <div>Pod IP: <span>${pod.pod_ip}</span></div>
              <div>CPU Request: <span>${pod.cpu_request}</span></div>
              <div>Memory Request: <span>${pod.memory_request}</span></div>
              <div style="margin-top: 10px; font-size: 11px; color: var(--text-dim);">Created ${pod.age} ago</div>
            </div>
          `;
          podsGrid.appendChild(card);
        });
      }

      // Update Git Commits Log
      const commitLog = document.getElementById("gitCommitLog");
      commitLog.innerHTML = "";

      const gitResponse = await fetch("/api/v1/git/log");
      const commits = await gitResponse.json();

      if (commits.length === 0) {
        commitLog.innerHTML = `<div style="text-align: center; color: var(--text-dim); padding: 20px;">No commits found in GitOps repository.</div>`;
      } else {
        commits.forEach(commit => {
          const li = document.createElement("li");
          li.style.display = "flex";
          li.style.flexDirection = "column";
          li.style.padding = "10px 0";
          li.style.borderBottom = "1px solid rgba(255,255,255,0.03)";
          
          li.innerHTML = `
            <div style="display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 4px;">
              <strong style="color: var(--text-main); font-family: var(--font-mono);">${commit.hash}</strong>
              <span style="color: var(--text-dim); font-size: 11px;">${commit.age}</span>
            </div>
            <div style="font-size: 13px; color: var(--text-muted);">${commit.message}</div>
            <div style="font-size: 11px; color: var(--accent-secondary); margin-top: 2px;">Author: ${commit.author}</div>
          `;
          commitLog.appendChild(li);
        });
      }
    } catch (err) {
      console.error("Failed to load Kubernetes and Git status:", err);
    }
  }

  // ==========================================================================
  // Keycloak Admin Panel
  // ==========================================================================
  async function loadKeycloakSettings() {
    try {
      const realmsRes = await fetch("/api/v1/keycloak/realms");
      const realms = await realmsRes.json();
      
      const realmsSelect = document.getElementById("kcRealmsSelect");
      realmsSelect.innerHTML = "";
      realms.forEach(realm => {
        const opt = document.createElement("option");
        opt.value = realm.id;
        opt.innerText = realm.name;
        realmsSelect.appendChild(opt);
      });

      // Load Users
      const usersRes = await fetch("/api/v1/keycloak/users");
      const users = await usersRes.json();
      const usersTbody = document.getElementById("kcUsersTbody");
      usersTbody.innerHTML = "";
      users.forEach(user => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td><strong>${user.username}</strong></td>
          <td>${user.email}</td>
          <td>${user.firstName} ${user.lastName}</td>
          <td><span class="status-indicator status-active">Enabled</span></td>
          <td>${user.emailVerified ? "Yes" : "No"}</td>
        `;
        usersTbody.appendChild(tr);
      });

      // Load Clients
      const clientsRes = await fetch("/api/v1/keycloak/clients");
      const clients = await clientsRes.json();
      const clientsTbody = document.getElementById("kcClientsTbody");
      clientsTbody.innerHTML = "";
      clients.forEach(client => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td><strong>${client.client_id}</strong></td>
          <td>${client.name}</td>
          <td><span style="font-family: var(--font-mono); font-size: 12px; color: var(--accent-secondary);">${client.protocol}</span></td>
          <td><span class="status-indicator status-active">Active</span></td>
          <td><code>${client.root_url}</code></td>
        `;
        clientsTbody.appendChild(tr);
      });
    } catch (err) {
      console.error("Failed to load Keycloak admin settings:", err);
    }
  }

  // Sub-Navigation in Keycloak Tab
  const kcSubItems = document.querySelectorAll(".keycloak-sub-item");
  const kcPanes = document.querySelectorAll(".kc-pane");

  kcSubItems.forEach(item => {
    item.addEventListener("click", () => {
      const targetPane = item.getAttribute("data-pane");
      kcSubItems.forEach(i => i.classList.remove("active"));
      kcPanes.forEach(p => p.style.display = "none");
      
      item.classList.add("active");
      document.getElementById(targetPane).style.display = "block";
    });
  });

  // ==========================================================================
  // TechDocs Navigation
  // ==========================================================================
  const docLinks = document.querySelectorAll(".docs-toc-link");
  const docArticles = document.querySelectorAll(".docs-article");

  docLinks.forEach(link => {
    link.addEventListener("click", () => {
      const targetArticle = link.getAttribute("data-doc");
      
      docLinks.forEach(l => l.classList.remove("active"));
      docArticles.forEach(a => a.style.display = "none");

      link.classList.add("active");
      document.getElementById(targetArticle).style.display = "block";
    });
  });

  // ==========================================================================
  // Template Forms & Modal Actions
  // ==========================================================================
  const modalOverlay = document.getElementById("scaffoldFormModal");
  const modalClose = document.getElementById("modalClose");
  const btnCancel = document.getElementById("btnCancel");
  const scaffoldForm = document.getElementById("scaffoldForm");

  // Dynamic templates selection
  const templates = {
    service: {
      title: "Create Service Template",
      inputs: `
        <div class="form-group">
          <label for="serviceName">Service Name</label>
          <input type="text" id="serviceName" class="form-control" placeholder="e.g. catalog-api" required>
          <div class="form-hint">Must be lowercase, alphanumeric, with hyphens.</div>
        </div>
        <div class="form-group">
          <label for="serviceNamespace">Target Namespace</label>
          <input type="text" id="serviceNamespace" class="form-control" value="default" placeholder="e.g. dev-team" required>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="imageRepository">Docker Image Repository</label>
            <input type="text" id="imageRepository" class="form-control" value="nginx" required>
          </div>
          <div class="form-group">
            <label for="imageTag">Docker Image Tag</label>
            <input type="text" id="imageTag" class="form-control" value="alpine" required>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="containerPort">Container Port</label>
            <input type="number" id="containerPort" class="form-control" value="80" required>
          </div>
          <div class="form-group">
            <label for="replicas">Replica Count</label>
            <input type="number" id="replicas" class="form-control" value="1" min="1" max="5" required>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="cpuRequest">CPU Request</label>
            <input type="text" id="cpuRequest" class="form-control" value="50m" required>
          </div>
          <div class="form-group">
            <label for="memoryRequest">Memory Request</label>
            <input type="text" id="memoryRequest" class="form-control" value="64Mi" required>
          </div>
        </div>
      `
    },
    database: {
      title: "Create Database Template",
      inputs: `
        <div class="form-group">
          <label for="dbName">Database Name</label>
          <input type="text" id="dbName" class="form-control" placeholder="e.g. orders-db" required>
        </div>
        <div class="form-group">
          <label for="dbNamespace">Target Namespace</label>
          <input type="text" id="dbNamespace" class="form-control" value="default" required>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="dbEngine">Database Engine</label>
            <select id="dbEngine" class="form-control" style="background: var(--bg-secondary);">
              <option value="postgresql">PostgreSQL (15-alpine)</option>
              <option value="redis">Redis (7-alpine)</option>
            </select>
          </div>
          <div class="form-group">
            <label for="storageSize">Volume Size (GB)</label>
            <input type="number" id="storageSize" class="form-control" value="5" min="1" max="20" required>
          </div>
        </div>
        <div class="form-row" id="dbCredentialsSection">
          <div class="form-group">
            <label for="dbUsername">Username</label>
            <input type="text" id="dbUsername" class="form-control" value="dbadmin">
          </div>
          <div class="form-group">
            <label for="dbPassword">Password</label>
            <input type="password" id="dbPassword" class="form-control" value="aegispass123">
          </div>
        </div>
      `
    },
    namespace: {
      title: "Create Namespace Template",
      inputs: `
        <div class="form-group">
          <label for="nsName">Namespace Name</label>
          <input type="text" id="nsName" class="form-control" placeholder="e.g. finance-dev" required>
        </div>
        <div class="form-group">
          <label for="nsEnv">Environment Type</label>
          <select id="nsEnv" class="form-control" style="background: var(--bg-secondary);">
            <option value="dev">Development (dev)</option>
            <option value="staging">Staging (staging)</option>
            <option value="prod">Production (prod)</option>
          </select>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="nsCpuLimit">CPU Hard Quota</label>
            <input type="text" id="nsCpuLimit" class="form-control" value="2" required>
          </div>
          <div class="form-group">
            <label for="nsMemLimit">Memory Hard Quota</label>
            <input type="text" id="nsMemLimit" class="form-control" value="4Gi" required>
          </div>
        </div>
      `
    },
    pipeline: {
      title: "Create CI/CD Pipeline Template",
      inputs: `
        <div class="form-group">
          <label for="pipelineName">Pipeline Name</label>
          <input type="text" id="pipelineName" class="form-control" placeholder="e.g. auth-service-ci" required>
        </div>
        <div class="form-group">
          <label for="pipelineRepo">Repository URI</label>
          <input type="text" id="pipelineRepo" class="form-control" value="github.com/aegis-org/auth-service" required>
        </div>
        <div class="form-group">
          <label for="pipelineBranch">Trigger Branch</label>
          <input type="text" id="pipelineBranch" class="form-control" value="main" required>
        </div>
        <div class="form-group">
          <label>Pipeline Stages</label>
          <div class="checkbox-group">
            <label class="checkbox-label"><input type="checkbox" id="stageLint" checked> Lint Check</label>
            <label class="checkbox-label"><input type="checkbox" id="stageTest" checked> Unit Tests</label>
            <label class="checkbox-label"><input type="checkbox" id="stageSonar" checked> SonarQube Scan</label>
            <label class="checkbox-label"><input type="checkbox" id="stageTrivy" checked> Trivy Vulnerability Scan</label>
            <label class="checkbox-label"><input type="checkbox" id="stageDocker" checked> Build Docker Image</label>
            <label class="checkbox-label"><input type="checkbox" id="stageDeploy" checked> Deploy to Kubernetes</label>
          </div>
        </div>
      `
    }
  };

  let activeTemplateType = "";

  // Open Template Modal
  window.openScaffoldModal = function(type) {
    activeTemplateType = type;
    const template = templates[type];
    
    document.getElementById("modalTitle").innerText = template.title;
    document.getElementById("dynamicInputs").innerHTML = template.inputs;
    
    // Toggle DB credentials section if engine is Redis
    if (type === "database") {
      const dbEngine = document.getElementById("dbEngine");
      dbEngine.addEventListener("change", () => {
        const credSection = document.getElementById("dbCredentialsSection");
        if (dbEngine.value === "redis") {
          credSection.style.display = "none";
        } else {
          credSection.style.display = "grid";
        }
      });
    }

    modalOverlay.style.display = "flex";
  };

  // Close Modal
  function closeModal() {
    modalOverlay.style.display = "none";
    scaffoldForm.reset();
  }

  modalClose.addEventListener("click", closeModal);
  btnCancel.addEventListener("click", closeModal);

  // Submit Scaffolding Template Form
  scaffoldForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    
    let payload = { type: activeTemplateType };
    
    if (activeTemplateType === "service") {
      payload.name = document.getElementById("serviceName").value;
      payload.namespace = document.getElementById("serviceNamespace").value;
      payload.image_repository = document.getElementById("imageRepository").value;
      payload.image_tag = document.getElementById("imageTag").value;
      payload.container_port = document.getElementById("containerPort").value;
      payload.replicas = document.getElementById("replicas").value;
      payload.cpu_request = document.getElementById("cpuRequest").value;
      payload.memory_request = document.getElementById("memoryRequest").value;
    } else if (activeTemplateType === "database") {
      payload.name = document.getElementById("dbName").value;
      payload.namespace = document.getElementById("dbNamespace").value;
      payload.engine = document.getElementById("dbEngine").value;
      payload.storage_size = document.getElementById("storageSize").value;
      if (payload.engine === "postgresql") {
        payload.username = document.getElementById("dbUsername").value;
        payload.password = document.getElementById("dbPassword").value;
      }
    } else if (activeTemplateType === "namespace") {
      payload.name = document.getElementById("nsName").value;
      payload.environment = document.getElementById("nsEnv").value;
      payload.cpu_limit = document.getElementById("nsCpuLimit").value;
      payload.memory_limit = document.getElementById("nsMemLimit").value;
    } else if (activeTemplateType === "pipeline") {
      payload.name = document.getElementById("pipelineName").value;
      payload.repository = document.getElementById("pipelineRepo").value;
      payload.branch = document.getElementById("pipelineBranch").value;
      
      let stages = [];
      if (document.getElementById("stageLint").checked) stages.push("Lint");
      if (document.getElementById("stageTest").checked) stages.push("Unit Tests");
      if (document.getElementById("stageSonar").checked) stages.push("SonarQube Check");
      if (document.getElementById("stageTrivy").checked) stages.push("Trivy Vulnerabilities");
      if (document.getElementById("stageDocker").checked) stages.push("Docker Image Build");
      if (document.getElementById("stageDeploy").checked) stages.push("GitOps Deploy");
      payload.steps = stages;
    }

    closeModal();

    try {
      const res = await fetch("/api/v1/scaffold", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        openConsoleModal(data.job_id);
      } else {
        alert("Failed to initiate template: " + data.message);
      }
    } catch (err) {
      console.error(err);
      alert("Error sending scaffolder request.");
    }
  });

  // ==========================================================================
  // Terminal Console Execution Logger
  // ==========================================================================
  const consoleModal = document.getElementById("consoleModal");
  const consoleClose = document.getElementById("consoleClose");
  const btnFinishConsole = document.getElementById("btnFinishConsole");
  let pollingInterval = null;

  function openConsoleModal(jobId) {
    btnFinishConsole.setAttribute("disabled", "true");
    document.getElementById("terminalOutput").innerText = "Connecting to scaffolder engine logs...\n";
    
    // Clear and build checklist
    document.getElementById("consoleModalTitle").innerText = "Executing Scaffolder Run";
    
    // Begin polling
    startConsolePolling(jobId);
    consoleModal.style.display = "flex";
  }

  function startConsolePolling(jobId) {
    if (pollingInterval) clearInterval(pollingInterval);

    pollingInterval = setInterval(async () => {
      try {
        // Fetch Job Status
        const statusRes = await fetch(`/api/v1/scaffold/status/${jobId}`);
        const statusData = await statusRes.json();

        // Render Steps List
        const stepsTracker = document.getElementById("stepsTracker");
        stepsTracker.innerHTML = "";

        statusData.steps.forEach((step, idx) => {
          const item = document.createElement("div");
          item.className = "step-tracker-item";
          
          let statusText = idx + 1;
          if (idx < statusData.current_step) {
            item.classList.add("completed");
            statusText = "✓";
          } else if (idx === statusData.current_step && statusData.status === "running") {
            item.classList.add("active");
            statusText = "⚙";
          } else if (idx === statusData.current_step && statusData.status === "error") {
            item.classList.add("failed");
            statusText = "✗";
          }

          item.innerHTML = `
            <span class="step-tracker-icon">${statusText}</span>
            <span>${step}</span>
          `;
          stepsTracker.appendChild(item);
        });

        // Fetch logs
        const logsRes = await fetch(`/api/v1/scaffold/logs/${jobId}`);
        const logsData = await logsRes.json();
        
        const terminal = document.getElementById("terminalOutput");
        terminal.innerText = logsData.logs;
        terminal.scrollTop = terminal.scrollHeight; // Autoscroll

        // End conditions
        if (statusData.status === "success" || statusData.status === "error") {
          clearInterval(pollingInterval);
          btnFinishConsole.removeAttribute("disabled");
          
          // Refresh lists
          loadCatalog();
          loadK8sStatus();
        }
      } catch (err) {
        console.error("Error polling console status:", err);
      }
    }, 850);
  }

  function closeConsoleModal() {
    if (pollingInterval) clearInterval(pollingInterval);
    consoleModal.style.display = "none";
  }

  consoleClose.addEventListener("click", closeConsoleModal);
  btnFinishConsole.addEventListener("click", closeConsoleModal);

  // ==========================================================================
  // DevOps Portfolio Infographic Details
  // ==========================================================================
  const portfolioProjects = {
    1: {
      id: 1,
      title: "Enterprise DevSecOps CI/CD Pipeline",
      stage: "Stage 1: Junior DevOps (Months 1-2)",
      stageClass: "stage-badge-junior",
      timeframe: "Months 1-2",
      tools: ["Git", "GitHub Actions", "Docker", "SonarQube", "Trivy", "ECR", "Kubernetes", "Slack"],
      goal: "Establish secure, automated building and deployment cycles. Eliminates manual releases and prevents credential leaks or security vulnerabilities from reaching production.",
      skills: ["Git workflows & Branching Policies", "Docker containerization", "Vulnerability scanning with Trivy", "Static Code Analysis (SonarQube)", "Automated Kubernetes deployments"],
      diagram: `
        <div class="diagram-row-flow">
          <div class="diagram-node"><span class="diagram-node-sub">Developer</span>Git Commit</div>
          <span class="diagram-arrow-connector">→</span>
          <div class="diagram-node"><span class="diagram-node-sub">GitHub</span>Trigger CI</div>
          <span class="diagram-arrow-connector">→</span>
          <div class="diagram-node"><span class="diagram-node-sub">GH Actions</span>Scan & Build</div>
          <span class="diagram-arrow-connector">→</span>
          <div class="diagram-node"><span class="diagram-node-sub">Security</span>Trivy / Sonar</div>
          <span class="diagram-arrow-connector">→</span>
          <div class="diagram-node"><span class="diagram-node-sub">Registry</span>Push ECR</div>
          <span class="diagram-arrow-connector">→</span>
          <div class="diagram-node"><span class="diagram-node-sub">K8s Cluster</span>Web workload</div>
        </div>
      `
    },
    2: {
      id: 2,
      title: "Production Observability Platform",
      stage: "Stage 1: Junior DevOps (Months 1-2)",
      stageClass: "stage-badge-junior",
      timeframe: "Months 1-2",
      tools: ["Prometheus", "Grafana", "Loki", "Tempo", "OpenTelemetry", "AlertManager"],
      goal: "Implement multi-dimensional monitoring, tracing, and logging for entire microservice environments to quickly identify bottlenecks and debug latency anomalies.",
      skills: ["Distributed tracing propagation", "Log aggregation & queries (LogQL)", "Alerting rule definitions", "Grafana visualization dashboards", "OpenTelemetry instrumentation"],
      diagram: `
        <div class="diagram-row-flow">
          <div class="diagram-node"><span class="diagram-node-sub">App Workloads</span>Metrics & Traces</div>
          <span class="diagram-arrow-connector">→</span>
          <div class="diagram-node"><span class="diagram-node-sub">OTel Collector</span>Receive & Export</div>
          <span class="diagram-arrow-connector">→</span>
          <div class="diagram-node highlight"><span class="diagram-node-sub">Prometheus / Loki</span>Metrics / Logs</div>
          <span class="diagram-arrow-connector">→</span>
          <div class="diagram-node"><span class="diagram-node-sub">Grafana</span>Unified View</div>
        </div>
      `
    },
    3: {
      id: 3,
      title: "Kubernetes Security Operations Center",
      stage: "Stage 2: Mid-Level DevOps (Months 3-4)",
      stageClass: "stage-badge-mid",
      timeframe: "Months 3-4",
      tools: ["Falco", "Trivy Operator", "Open Policy Agent (OPA)", "Kyverno", "Grafana"],
      goal: "Implement zero-trust security controls. Detect and prevent runtime anomalies (privilege escalations, shell execution) and block unsecure resources at the admission level.",
      skills: ["Kubernetes Admission Control", "Policy-as-Code definitions", "eBPF-based runtime security auditing", "Vulnerability reporting", "Securing API Server endpoints"],
      diagram: `
        <div class="diagram-row-flow">
          <div class="diagram-node"><span class="diagram-node-sub">API Request</span>kubectl apply</div>
          <span class="diagram-arrow-connector">→</span>
          <div class="diagram-node"><span class="diagram-node-sub">Kyverno Admission</span>Policy Check</div>
          <span class="diagram-arrow-connector">→</span>
          <div class="diagram-node"><span class="diagram-node-sub">Cluster Node</span>Falco eBPF Agent</div>
          <span class="diagram-arrow-connector">→</span>
          <div class="diagram-node highlight"><span class="diagram-node-sub">Slack / Grafana</span>Threat Alerts</div>
        </div>
      `
    },
    4: {
      id: 4,
      title: "Self-Healing Infrastructure Platform",
      stage: "Stage 2: Mid-Level DevOps (Months 3-4)",
      stageClass: "stage-badge-mid",
      timeframe: "Months 3-4",
      tools: ["Kubernetes", "Prometheus", "AlertManager", "Python", "Ansible"],
      goal: "Eliminate downtime by building automated remediation tasks that hook directly into monitoring alerts to resolve failures (OOM kills, disk pressure, crashed endpoints) automatically.",
      skills: ["Automated incident response", "Webhooks integrations", "Python automation scripts", "Ansible configuration tasks", "Kubernetes API interaction"],
      diagram: `
        <div class="diagram-row-flow">
          <div class="diagram-node"><span class="diagram-node-sub">Pod Crash</span>Failure Trigger</div>
          <span class="diagram-arrow-connector">→</span>
          <div class="diagram-node"><span class="diagram-node-sub">Prometheus Alert</span>Detect outage</div>
          <span class="diagram-arrow-connector">→</span>
          <div class="diagram-node"><span class="diagram-node-sub">AlertManager</span>Send webhook</div>
          <span class="diagram-arrow-connector">→</span>
          <div class="diagram-node highlight"><span class="diagram-node-sub">Remediation Engine</span>Python Handler</div>
          <span class="diagram-arrow-connector">→</span>
          <div class="diagram-node"><span class="diagram-node-sub">Cluster API</span>Restart Pod</div>
        </div>
      `
    },
    5: {
      id: 5,
      title: "FinOps Cost Optimization Platform",
      stage: "Stage 2: Mid-Level DevOps (Months 3-4)",
      stageClass: "stage-badge-mid",
      timeframe: "Months 3-4",
      tools: ["AWS", "Kubecost", "Grafana", "AWS Lambda", "Python"],
      goal: "Track cluster costs and enforce cloud resource optimization rules. Runs periodic serverless scans to detect idle resources, untagged workloads, and over-provisioned nodes.",
      skills: ["Cloud resource sizing", "Billing allocations & Tagging", "Kubecost configuration", "AWS Serverless orchestration", "FinOps savings strategies"],
      diagram: `
        <div class="diagram-row-flow">
          <div class="diagram-node"><span class="diagram-node-sub">K8s Clusters</span>Workloads</div>
          <span class="diagram-arrow-connector">⇄</span>
          <div class="diagram-node"><span class="diagram-node-sub">Kubecost</span>Estimate spend</div>
          <span class="diagram-arrow-connector">→</span>
          <div class="diagram-node highlight"><span class="diagram-node-sub">Lambda Scanner</span>Shutdown Idle</div>
          <span class="diagram-arrow-connector">→</span>
          <div class="diagram-node"><span class="diagram-node-sub">Grafana UI</span>FinOps dashboard</div>
        </div>
      `
    },
    6: {
      id: 6,
      title: "GitOps Platform Engineering System",
      stage: "Stage 3: Senior DevOps / Platform (Months 5-7)",
      stageClass: "stage-badge-senior",
      timeframe: "Months 5-7",
      tools: ["ArgoCD", "Helm", "Kubernetes", "Terraform"],
      goal: "Implement a declarative, revision-controlled operations cycle. The Git repository acts as the single source of truth for the entire infrastructure, deploying and reconciling resources.",
      skills: ["Declarative GitOps paradigms", "ArgoCD Application controller", "Helm packaging & templating", "Dry-run verification tests", "State synchronization & drift detection"],
      diagram: `
        <div class="diagram-row-flow">
          <div class="diagram-node"><span class="diagram-node-sub">Git repo</span>Helm charts</div>
          <span class="diagram-arrow-connector">←Reconcile</span>
          <div class="diagram-node highlight"><span class="diagram-node-sub">ArgoCD</span>Check state diff</div>
          <span class="diagram-arrow-connector">→</span>
          <div class="diagram-node"><span class="diagram-node-sub">K8s Clusters</span>Sync resources</div>
        </div>
      `
    },
    7: {
      id: 7,
      title: "Aegis Internal Developer Platform (IDP)",
      stage: "Stage 3: Senior DevOps / Platform (Months 5-7) • ACTIVE",
      stageClass: "stage-badge-senior",
      timeframe: "Months 5-7 (Active)",
      tools: ["Backstage Portal UI", "Keycloak Identity IAM", "Terraform", "Git", "ArgoCD", "Kubernetes"],
      goal: "Eliminate developer friction by establishing 'Golden Paths' (pre-defined templates). Developers can create namespaces, database environments, pipelines, and services independently.",
      skills: ["Developer Experience (DevEx) design", "Infrastructure Scaffolding automation", "Identity Federations (SSO)", "Unified REST API Orchestration", "RBAC control mappings"],
      diagram: `
        <div class="diagram-row-flow">
          <div class="diagram-node"><span class="diagram-node-sub">Developer</span>Portal Request</div>
          <span class="diagram-arrow-connector">→</span>
          <div class="diagram-node highlight"><span class="diagram-node-sub">Aegis IDP Flask</span>Orchestrator</div>
          <span class="diagram-arrow-connector">→</span>
          <div class="diagram-node"><span class="diagram-node-sub">Terraform Runs</span>Apply Namespace/DB</div>
          <span class="diagram-arrow-connector">+</span>
          <div class="diagram-node"><span class="diagram-node-sub">Local GitOps Repo</span>Commit Helm configs</div>
          <span class="diagram-arrow-connector">→</span>
          <div class="diagram-node"><span class="diagram-node-sub">ArgoCD</span>Reconcile Pods</div>
        </div>
      `
    },
    8: {
      id: 8,
      title: "Multi-Cloud Disaster Recovery",
      stage: "Stage 4: Staff Engineer (Months 8-10)",
      stageClass: "stage-badge-staff",
      timeframe: "Months 8-10",
      tools: ["AWS Route53", "Azure Traffic Manager", "GCP DNS", "Velero", "Terraform"],
      goal: "Ensure zero-downtime application durability across distinct cloud providers (AWS and Azure) by setting up DNS-level latency routing and automated state replication.",
      skills: ["Multi-cloud network design", "Active-Active DR planning", "Automated backups with Velero", "Global DNS failover triggers", "State replication patterns"],
      diagram: `
        <div class="diagram-row-flow">
          <div class="diagram-node"><span class="diagram-node-sub">Global Users</span>Web traffic</div>
          <span class="diagram-arrow-connector">→</span>
          <div class="diagram-node"><span class="diagram-node-sub">DNS Traffic Mgr</span>Latency routing</div>
          <span class="diagram-arrow-connector">↙ ↘</span>
          <div class="diagram-node"><span class="diagram-node-sub">AWS Cluster</span>Active Primary</div>
          <span class="diagram-arrow-connector">⇄ Replicate</span>
          <div class="diagram-node"><span class="diagram-node-sub">Azure Cluster</span>Hot Standby</div>
        </div>
      `
    },
    9: {
      id: 9,
      title: "AIOps Command Center",
      stage: "Stage 4: Staff Engineer (Months 8-10)",
      stageClass: "stage-badge-staff",
      timeframe: "Months 8-10",
      tools: ["OpenAI API", "LangChain", "Prometheus", "Loki", "Python"],
      goal: "Integrate LLM-driven agents to manage platform incidents. The AI analyzes real-time alert logs and metrics to output immediate diagnostic causes and recovery options.",
      skills: ["Generative AI for Operations (AIOps)", "Prompt engineering & RAG", "Diagnostic automation", "Structured logs preprocessing", "Alert context enrichment"],
      diagram: `
        <div class="diagram-row-flow">
          <div class="diagram-node"><span class="diagram-node-sub">Outage / Exception</span>System Fault</div>
          <span class="diagram-arrow-connector">→</span>
          <div class="diagram-node"><span class="diagram-node-sub">Prometheus Alert</span>Trigger alert</div>
          <span class="diagram-arrow-connector">→</span>
          <div class="diagram-node highlight"><span class="diagram-node-sub">AIOps Python Agent</span>Gather logs & metrics</div>
          <span class="diagram-arrow-connector">→</span>
          <div class="diagram-node"><span class="diagram-node-sub">OpenAI LLM</span>RCA & Fix</div>
          <span class="diagram-arrow-connector">→</span>
          <div class="diagram-node"><span class="diagram-node-sub">Slack Channel</span>Incident Summary</div>
        </div>
      `
    },
    10: {
      id: 10,
      title: "DevOpsVerse Enterprise Cloud Platform",
      stage: "Stage 5: Principal Engineer (Months 11-12) • FLAGSHIP",
      stageClass: "stage-badge-principal",
      timeframe: "Months 11-12",
      tools: ["Next.js", "NestJS", "Kafka", "PostgreSQL", "Istio Service Mesh", "Terraform", "ArgoCD", "Falco", "Prometheus", "OpenAI"],
      goal: "The ultimate flagship project combining every single stage of your DevOps career. A globally scalable, secure, AI-augmented, and cost-controlled enterprise platform.",
      skills: ["Global Enterprise architecture", "Service Mesh configurations (Istio)", "Event-driven system designs", "Unified SRE & Governance controls", "Principal-level leadership story"],
      diagram: `
        <div class="diagram-row-flow">
          <div class="diagram-node"><span class="diagram-node-sub">Frontend</span>Next.js UI</div>
          <span class="diagram-arrow-connector">→</span>
          <div class="diagram-node"><span class="diagram-node-sub">Istio Mesh</span>Secure routes</div>
          <span class="diagram-arrow-connector">→</span>
          <div class="diagram-node"><span class="diagram-node-sub">NestJS Microservices</span>Event-driven</div>
          <span class="diagram-arrow-connector">⇄ Kafka</span>
          <div class="diagram-node"><span class="diagram-node-sub">PostgreSQL</span>Stateful DB</div>
        </div>
      `
    }
  };

  window.loadPortfolioDetails = function(projectId) {
    const project = portfolioProjects[projectId];
    if (!project) return;

    // Highlight card
    const cards = document.querySelectorAll(".timeline-project-card");
    cards.forEach(card => {
      const cardId = parseInt(card.getAttribute("data-project-id"));
      if (cardId === projectId) {
        if (projectId === 7) {
          card.className = "timeline-project-card active-project";
        } else if (projectId === 8 || projectId === 9) {
          card.className = "timeline-project-card locked active-selection";
        } else if (projectId === 10) {
          card.className = "timeline-project-card flagship-locked active-selection";
        } else {
          card.className = "timeline-project-card completed active-selection";
        }
      } else {
        // Reset classnames based on default state
        if (cardId === 7) {
          card.className = "timeline-project-card active-project";
        } else if (cardId === 8 || cardId === 9) {
          card.className = "timeline-project-card locked";
        } else if (cardId === 10) {
          card.className = "timeline-project-card flagship-locked";
        } else {
          card.className = "timeline-project-card completed";
        }
      }
    });

    // Populate details panel
    const detailsPanel = document.getElementById("projectDetailsPanel");
    
    // Tools list markup
    const toolsMarkup = project.tools.map(tool => `<span class="tech-tag">${tool}</span>`).join("");
    
    // Skills list markup
    const skillsMarkup = project.skills.map(skill => `<li>${skill}</li>`).join("");

    detailsPanel.innerHTML = `
      <div class="detail-header">
        <span class="detail-stage-badge ${project.stageClass}">${project.stage}</span>
        <h3 class="detail-title">${project.title}</h3>
        <div class="detail-meta-grid">
          <div class="detail-meta-item">Timeframe: <strong>${project.timeframe}</strong></div>
          <div class="detail-meta-item" style="text-align: right;">Status: <strong>${projectId === 7 ? "ACTIVE (In Progress)" : (projectId < 7 ? "COMPLETED" : "LOCKED / NEXT UP")}</strong></div>
        </div>
      </div>

      <div class="detail-section-title">Core Technology Stack</div>
      <div class="tech-tags-wrapper">
        ${toolsMarkup}
      </div>

      <div class="detail-section-title">Project Goal & Architecture</div>
      <p class="detail-description">${project.goal}</p>

      <div class="detail-diagram-container">
        ${project.diagram}
      </div>

      <div class="detail-section-title">Core Competencies Developed</div>
      <ul class="detail-skills-list">
        ${skillsMarkup}
      </ul>
    `;
  };

  // Add click listeners to cards
  const timelineCards = document.querySelectorAll(".timeline-project-card");
  timelineCards.forEach(card => {
    card.addEventListener("click", () => {
      const projectId = parseInt(card.getAttribute("data-project-id"));
      loadPortfolioDetails(projectId);
    });
  });
  
  // Set default view on load if we are on the portfolio tab
  loadPortfolioDetails(7);
});
