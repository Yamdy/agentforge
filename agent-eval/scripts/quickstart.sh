#!/bin/bash
set -euo pipefail

# ============================================================
# Quick Start: Run a minimal SWE-bench evaluation
# Usage: ./quickstart.sh [api_key]
# ============================================================

EVAL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$EVAL_DIR"

if [[ -f .env ]]; then
    source .env
fi

if [[ -n "${1:-}" ]]; then
    export ANTHROPIC_API_KEY="$1"
fi

if [[ -z "${ANTHROPIC_API_KEY:-}" && -z "${OPENAI_API_KEY:-}" ]]; then
    echo "ERROR: Set ANTHROPIC_API_KEY or OPENAI_API_KEY"
    echo "  export ANTHROPIC_API_KEY=your-key"
    echo "  or:  ./quickstart.sh your-key"
    exit 1
fi

MODEL="${DEFAULT_MODEL:-claude-sonnet-4-20250514}"
DATASET="verified"
MAX_INSTANCES=5
COST_LIMIT=2.0

echo "============================================================"
echo "  Agent Eval Quick Start"
echo "  Model: $MODEL"
echo "  Dataset: SWE-bench $DATASET (first $MAX_INSTANCES instances)"
echo "  Cost limit: \$${COST_LIMIT}/instance"
echo "============================================================"

echo ""
echo "[1/3] Running inference on $MAX_INSTANCES instances..."
python3 scripts/run_swebench_inference.py \
    --model "$MODEL" \
    --dataset "$DATASET" \
    --max-instances "$MAX_INSTANCES" \
    --cost-limit "$COST_LIMIT" \
    --output-dir ./results

PREDICTIONS=$(ls -t results/run_*/predictions.json 2>/dev/null | head -1)
if [[ -z "$PREDICTIONS" ]]; then
    for f in $(ls -t results/run_*/*.json 2>/dev/null | head -5); do
        if python3 -c "import json; d=json.load(open('$f')); assert 'model_patch' in str(d) or isinstance(d, dict)" 2>/dev/null; then
            PREDICTIONS="$f"
            break
        fi
    done
fi

if [[ -z "$PREDICTIONS" ]]; then
    echo "ERROR: No predictions file found"
    exit 1
fi

echo ""
echo "[2/3] Submitting to cloud evaluation..."
python3 scripts/run_swebench_eval.py \
    --mode cloud \
    --dataset "$DATASET" \
    --predictions "$PREDICTIONS"

echo ""
echo "[3/3] Done! Check results with:"
echo "  sb-cli get-report swe-bench_verified dev <run_id>"
echo "  sb-cli list-runs swe-bench_verified dev"
