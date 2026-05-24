#!/usr/bin/env python3
"""Evaluate SWE-bench predictions locally (requires Docker) or via sb-cli (cloud)."""

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path


DATASETS = {
    "verified": "princeton-nlp/SWE-bench_Verified",
    "lite": "princeton-nlp/SWE-bench_Lite",
    "full": "princeton-nlp/SWE-bench",
    "multilingual": "princeton-nlp/SWE-bench_Multilingual",
}


def evaluate_local(predictions_path: str, dataset_name: str, max_workers: int, cache_level: str, run_id: str):
    print(f"Running LOCAL evaluation (requires Docker)")
    print(f"  Predictions: {predictions_path}")
    print(f"  Dataset:     {dataset_name}")

    cmd = [
        sys.executable, "-m", "swebench.harness.run_evaluation",
        "--dataset_name", dataset_name,
        "--predictions_path", predictions_path,
        "--max_workers", str(max_workers),
        "--cache_level", cache_level,
        "--run_id", run_id,
    ]

    result = subprocess.run(cmd, env=os.environ.copy())
    if result.returncode != 0:
        print(f"ERROR: Local evaluation failed with return code {result.returncode}")
        sys.exit(1)

    print("Local evaluation complete!")


def evaluate_cloud(predictions_path: str, dataset: str, run_id: str):
    print(f"Running CLOUD evaluation via sb-cli")
    print(f"  Predictions: {predictions_path}")
    print(f"  Dataset:     {dataset}")

    sb_dataset_map = {
        "verified": "swe-bench_verified",
        "lite": "swe-bench_lite",
        "multilingual": "swe-bench-m",
    }

    sb_dataset = sb_dataset_map.get(dataset)
    if not sb_dataset:
        print(f"ERROR: Cloud evaluation not available for dataset '{dataset}'")
        print(f"Available: {list(sb_dataset_map.keys())}")
        sys.exit(1)

    cmd = [
        "sb-cli", "submit", sb_dataset, "dev",
        "--predictions_path", predictions_path,
        "--run_id", run_id,
    ]

    result = subprocess.run(cmd, env=os.environ.copy())
    if result.returncode != 0:
        print(f"ERROR: Cloud submission failed with return code {result.returncode}")
        sys.exit(1)

    print(f"\nTo check results later:")
    print(f"  sb-cli get-report {sb_dataset} dev {run_id}")


def evaluate_gold(instance_id: str, max_workers: int):
    print(f"Validating evaluation setup with gold patch on: {instance_id}")

    cmd = [
        sys.executable, "-m", "swebench.harness.run_evaluation",
        "--max_workers", str(max_workers),
        "--instance_ids", instance_id,
        "--predictions_path", "gold",
        "--run_id", f"validate-gold-{datetime.now().strftime('%Y%m%d')}",
    ]

    result = subprocess.run(cmd, env=os.environ.copy())
    if result.returncode != 0:
        print(f"ERROR: Gold validation failed")
        sys.exit(1)

    print("Gold patch validation passed!")


def main():
    parser = argparse.ArgumentParser(description="Evaluate SWE-bench predictions")
    parser.add_argument(
        "--mode", choices=["local", "cloud", "gold"], default="cloud",
        help="Evaluation mode: local (Docker), cloud (sb-cli), or gold (validate setup)",
    )
    parser.add_argument(
        "--predictions", default=None,
        help="Path to predictions JSON file",
    )
    parser.add_argument(
        "--dataset", default="verified", choices=list(DATASETS.keys()),
        help="Dataset variant (default: verified)",
    )
    parser.add_argument(
        "--max-workers", type=int, default=4,
        help="Max parallel workers for local eval (default: 4)",
    )
    parser.add_argument(
        "--cache-level", default="env", choices=["none", "base", "env", "instance"],
        help="Docker cache level for local eval (default: env)",
    )
    parser.add_argument(
        "--run-id", default=None,
        help="Run ID (auto-generated if not provided)",
    )
    parser.add_argument(
        "--instance-id", default="sympy__sympy-20590",
        help="Instance ID for gold validation (default: sympy__sympy-20590)",
    )

    args = parser.parse_args()

    if args.mode == "gold":
        evaluate_gold(args.instance_id, args.max_workers)
        return

    if not args.predictions:
        print("ERROR: --predictions is required for local/cloud mode")
        sys.exit(1)

    if not Path(args.predictions).exists():
        print(f"ERROR: Predictions file not found: {args.predictions}")
        sys.exit(1)

    run_id = args.run_id or f"eval-{datetime.now().strftime('%Y%m%d_%H%M%S')}"

    if args.mode == "local":
        dataset_name = DATASETS[args.dataset]
        evaluate_local(args.predictions, dataset_name, args.max_workers, args.cache_level, run_id)
    elif args.mode == "cloud":
        evaluate_cloud(args.predictions, args.dataset, run_id)


if __name__ == "__main__":
    main()
