#!/bin/bash
set -euo pipefail

# ============================================================
# Agent Eval: Cloud VM One-Click Deployment Script
# Supports: Ubuntu 22.04+, Debian 12+
# Requirements: Fresh VM with root/sudo access
# ============================================================

set -a
PYTHON_VERSION="${PYTHON_VERSION:-3.12}"
EVAL_DIR="${EVAL_DIR:-/opt/agent-eval}"
SWEBENCH_REPO="${SWEBENCH_REPO:-https://github.com/princeton-nlp/SWE-bench.git}"
SWEAGENT_REPO="${SWEAGENT_REPO:-https://github.com/SWE-agent/SWE-agent.git}"
TBENCH_REPO="${TBENCH_REPO:-https://github.com/laude-institute/terminal-bench.git}"
MAX_WORKERS="${MAX_WORKERS:-$(nproc)}"
set +a

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }

check_root() {
    if [[ $EUID -ne 0 ]]; then
        log_error "This script must be run as root (use sudo)"
        exit 1
    fi
}

check_resources() {
    local cpu=$(nproc)
    local ram_gb=$(free -g | awk '/^Mem:/{print $2}')
    local disk_gb=$(df -BG / | awk 'NR==2{print $4}' | tr -d 'G')

    log_info "System resources: CPU=${cpu} cores, RAM=${ram_gb}GB, Disk=${disk_gb}GB free"

    if [[ $cpu -lt 4 ]]; then
        log_warn "Less than 4 CPU cores - evaluation will be slow"
    fi
    if [[ $ram_gb -lt 8 ]]; then
        log_warn "Less than 8GB RAM - may cause OOM with Docker"
    fi
    if [[ $disk_gb -lt 100 ]]; then
        log_warn "Less than 100GB free disk - Docker images need significant space"
    fi
}

install_docker() {
    if command -v docker &>/dev/null; then
        log_info "Docker already installed: $(docker --version)"
        return
    fi

    log_info "Installing Docker..."
    apt-get update -qq
    apt-get install -y -qq ca-certificates curl gnupg

    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
        gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg

    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
        https://download.docker.com/linux/ubuntu \
        $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
        tee /etc/apt/sources.list.d/docker.list > /dev/null

    apt-get update -qq
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin

    systemctl start docker
    systemctl enable docker

    log_info "Docker installed: $(docker --version)"
}

install_python() {
    if python3 --version 2>&1 | grep -q "$PYTHON_VERSION"; then
        log_info "Python $PYTHON_VERSION already installed"
        return
    fi

    log_info "Installing Python $PYTHON_VERSION..."
    apt-get install -y -qq \
        software-properties-common \
        build-essential \
        libssl-dev \
        zlib1g-dev \
        libbz2-dev \
        libreadline-dev \
        libsqlite3-dev \
        libffi-dev \
        liblzma-dev \
        git

    if ! command -v pyenv &>/dev/null; then
        curl https://pyenv.run | bash
        export PYENV_ROOT="$HOME/.pyenv"
        export PATH="$PYENV_ROOT/bin:$PYENV_ROOT/shims:$PATH"
    fi

    pyenv install "$PYTHON_VERSION" 2>/dev/null || true
    pyenv global "$PYTHON_VERSION"

    log_info "Python installed: $(python3 --version)"
}

install_uv() {
    if command -v uv &>/dev/null; then
        log_info "uv already installed: $(uv --version)"
        return
    fi
    log_info "Installing uv..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    export PATH="$HOME/.local/bin:$PATH"
}

install_swebench() {
    log_info "Installing SWE-bench..."
    local dir="$EVAL_DIR/SWE-bench"
    if [[ ! -d "$dir" ]]; then
        git clone "$SWEBENCH_REPO" "$dir"
    fi
    cd "$dir"
    pip install -e ".[inference]"
    log_info "SWE-bench installed"
}

install_sweagent() {
    log_info "Installing SWE-agent..."
    local dir="$EVAL_DIR/SWE-agent"
    if [[ ! -d "$dir" ]]; then
        git clone "$SWEAGENT_REPO" "$dir"
    fi
    cd "$dir"
    pip install --upgrade pip && pip install --editable .
    log_info "SWE-agent installed: $(sweagent --version 2>&1 | head -1)"
}

install_sbcli() {
    log_info "Installing sb-cli..."
    pip install sb-cli
    log_info "sb-cli installed"
}

install_terminal_bench() {
    log_info "Installing Terminal-Bench..."
    local dir="$EVAL_DIR/terminal-bench"
    if [[ ! -d "$dir" ]]; then
        git clone "$TBENCH_REPO" "$dir"
    fi
    cd "$dir"
    uv sync
    pip install -e .
    log_info "Terminal-Bench installed"
}

setup_project() {
    log_info "Setting up project structure..."
    mkdir -p "$EVAL_DIR"/{scripts,configs,results,logs}

    if [[ -d "/workspace/agent-eval/scripts" ]]; then
        cp -v /workspace/agent-eval/scripts/*.py "$EVAL_DIR/scripts/"
    fi

    log_info "Project structure created at $EVAL_DIR"
}

setup_env_template() {
    local env_file="$EVAL_DIR/.env.example"
    cat > "$env_file" << 'EOF'
# API Keys (set at least one)
ANTHROPIC_API_KEY=your-anthropic-key-here
OPENAI_API_KEY=your-openai-key-here

# SWE-bench Cloud Evaluation
SWEBENCH_API_KEY=your-swebench-api-key-here

# Optional: Model configuration
DEFAULT_MODEL=claude-sonnet-4-20250514
COST_LIMIT=3.0
MAX_WORKERS=4
EOF
    chmod 600 "$env_file"
    log_info "Environment template created at $env_file"
}

validate_installation() {
    log_info "Validating installation..."
    local errors=0

    python3 -c "import swebench; print(f'  swebench: {swebench.__version__}')" || { log_error "swebench import failed"; errors=$((errors+1)); }
    python3 -c "import sweagent; print(f'  sweagent: OK')" || { log_error "sweagent import failed"; errors=$((errors+1)); }
    command -v sb-cli &>/dev/null && echo "  sb-cli: $(sb-cli --version 2>&1 | head -1)" || { log_warn "sb-cli not found"; }
    command -v docker &>/dev/null && echo "  docker: $(docker --version)" || { log_error "docker not found"; errors=$((errors+1)); }
    command -v sweagent &>/dev/null && echo "  sweagent CLI: OK" || { log_warn "sweagent CLI not in PATH"; }

    if [[ $errors -eq 0 ]]; then
        log_info "All validations passed!"
    else
        log_error "$errors validation(s) failed"
        return 1
    fi
}

run_smoke_test() {
    log_info "Running smoke test (gold patch validation)..."
    python3 -m swebench.harness.run_evaluation \
        --max_workers 1 \
        --instance_ids "sympy__sympy-20590" \
        --predictions_path gold \
        --run_id smoke-test \
        --cache_level env

    log_info "Smoke test complete!"
}

main() {
    echo ""
    echo "============================================================"
    echo "  Agent Eval - Cloud VM Deployment"
    echo "  Python: $PYTHON_VERSION | Dir: $EVAL_DIR"
    echo "============================================================"
    echo ""

    check_root
    check_resources

    apt-get update -qq

    install_docker
    install_python
    install_uv
    install_swebench
    install_sweagent
    install_sbcli
    install_terminal_bench
    setup_project
    setup_env_template
    validate_installation

    echo ""
    echo "============================================================"
    echo "  Deployment Complete!"
    echo ""
    echo "  Next steps:"
    echo "  1. Copy .env.example to .env and fill in API keys:"
    echo "     cp $EVAL_DIR/.env.example $EVAL_DIR/.env"
    echo "     vim $EVAL_DIR/.env"
    echo ""
    echo "  2. Source environment:"
    echo "     source $EVAL_DIR/.env"
    echo ""
    echo "  3. Run a quick test:"
    echo "     cd $EVAL_DIR"
    echo "     python scripts/run_swebench_inference.py --dataset verified --max-instances 5"
    echo "     python scripts/run_swebench_eval.py --mode cloud --predictions results/.../predictions.json"
    echo ""
    echo "  4. Or run the full pipeline:"
    echo "     python scripts/run_full_pipeline.py --dataset verified --max-instances 10"
    echo "============================================================"
}

main "$@"
