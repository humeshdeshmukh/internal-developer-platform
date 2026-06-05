FROM python:3.11-slim

# Install system dependencies: git, curl, unzip
RUN apt-get update && \
    apt-get install -y git curl unzip && \
    rm -rf /var/lib/apt/lists/*

# Download and install Terraform
RUN curl -LO https://releases.hashicorp.com/terraform/1.8.0/terraform_1.8.0_linux_amd64.zip && \
    unzip terraform_1.8.0_linux_amd64.zip -d /usr/local/bin/ && \
    rm terraform_1.8.0_linux_amd64.zip

# Download and install kubectl
RUN curl -LO "https://dl.k8s.io/release/v1.28.2/bin/linux/amd64/kubectl" && \
    chmod +x kubectl && \
    mv kubectl /usr/local/bin/

# Configure Git settings inside the container
RUN git config --global user.name "Aegis IDP Portal" && \
    git config --global user.email "portal@aegis.local" && \
    git config --global safe.directory "*"

WORKDIR /app

# Install Python requirements
COPY app/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application source code
COPY app/ /app/

EXPOSE 5007

# Run Flask portal
CMD ["python", "main.py"]
